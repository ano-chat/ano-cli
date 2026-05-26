/**
 * ano-daemon client — the thin shim that the `ano` binary runs first on
 * every invocation. Tries to talk to a running daemon over a Unix
 * socket; if no daemon answers, returns false so `src/index.ts` can fall
 * back to direct execution.
 *
 * Imports here are deliberately minimal — only `node:net`, `node:fs`,
 * `node:child_process`, and the small protocol module. The full command
 * tree is dynamic-imported inside `src/index.ts` only on the fallback
 * path, so warm-daemon calls skip parsing it entirely.
 *
 * Bypass rules (always run directly, never via daemon):
 *   • `ANO_NO_DAEMON=1` env var.
 *   • The `daemon` command itself (start/stop/status — must be local).
 *   • `auth login` / `complete` / `refresh-region` / `logout` — these
 *     interact with the browser + filesystem credentials in ways that
 *     are clearer when the calling shell owns the process.
 *   • Any argv hint that the command will read stdin (`--file -`, etc.).
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  PROTOCOL_VERSION,
  defaultPidPath,
  defaultSocketPath,
  frame,
  type DaemonResponse,
  type ExecRequest,
  type ExecResponse,
  type PingRequest,
  type PingResponse,
} from "./protocol.js";

declare const __VERSION__: string;
const CLI_VERSION =
  typeof __VERSION__ !== "undefined" ? __VERSION__ : "0.0.0-dev";

const CONNECT_TIMEOUT_MS = 150;
/**
 * Pre-flight ping deadline. The ping handler is in the per-frame
 * synchronous path on the daemon (no queue, no I/O), so 1 second is
 * generous for a healthy daemon and tight enough to surface a wedged
 * one before the user notices the hang. See `ensureHealthy()`.
 */
const PING_TIMEOUT_MS = 1000;
/**
 * Exec response deadline. The daemon is a best-effort accelerator over
 * the ~140 ms cold-Node startup; if it can't beat that comfortably it
 * isn't earning its keep. Crossing this deadline trips the circuit
 * breaker (see `tripCircuitBreaker`) so the next call bypasses the
 * daemon entirely.
 *
 * 3000 ms picked deliberately wide for v2.21 (was 800 ms in v2.20):
 *
 *  - Healthy local-daemon p99 is ~50 ms. Cloud-targeted (e.g. default
 *    profile pointing at api-us.ano.dev from a transatlantic user) is
 *    ~500 ms steady, with cold first-dispatch + handshake spiking
 *    700-1500 ms. The 800 ms ceiling tripped on normal-slow cloud calls,
 *    killing the daemon and locking the breaker for 10 min — which
 *    looked exactly like "the daemon mysteriously doesn't work." That
 *    was a worse failure mode than the 10 s stall it was meant to fix.
 *  - 3000 ms is still well below the original 10 s pathological hang
 *    AND below the daemon's own per-dispatch timeout (60 s). The
 *    breaker still catches truly wedged daemons; it just stops catching
 *    "normal cloud network".
 *  - Worst case becomes 3 s × once per 10-min cooldown (was 800 ms ×
 *    once before this change). For a structurally-wedged daemon, the
 *    user pays 3 s the first time, then ~140 ms per call until the
 *    cooldown reopens.
 */
const RESPONSE_TIMEOUT_MS = 3000;
/**
 * Circuit-breaker cooldown. After a single slow response (or other
 * daemon-side fault that suggests the warm process is in a bad state),
 * the CLI skips the daemon entirely for this window. Long enough that a
 * busy session doesn't keep retrying a wedged daemon; short enough that
 * a transient blip self-heals without the user noticing.
 */
const CIRCUIT_BREAKER_COOLDOWN_MS = 10 * 60 * 1000;

// `dev` runs sanity checks that need to read the calling process's
// profile/env directly AND probe daemon state — must run in-process.
const BYPASS_TOP_LEVEL = new Set(["daemon", "dev"]);
const BYPASS_NESTED: Array<[string, string]> = [
  ["auth", "login"],
  ["auth", "complete"],
  ["auth", "refresh-region"],
  ["auth", "logout"],
];

/** First non-flag token, plus the second non-flag token (subcommand). */
function topAndSub(argv: string[]): [string | null, string | null] {
  let top: string | null = null;
  let sub: string | null = null;
  for (const a of argv) {
    if (a.startsWith("-")) continue;
    if (top === null) top = a;
    else if (sub === null) {
      sub = a;
      break;
    }
  }
  return [top, sub];
}

function looksLikeStdinFile(argv: string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // `--file -` or `-f -` — common stdin convention.
    if ((a === "--file" || a === "-f") && argv[i + 1] === "-") return true;
    // `--file=-` form.
    if (a === "--file=-" || a === "-f=-") return true;
  }
  return false;
}

/** Decide whether the daemon path applies for this invocation. */
export function shouldBypass(argv: string[]): boolean {
  if (process.env.ANO_NO_DAEMON === "1" || process.env.ANO_NO_DAEMON === "true")
    return true;
  // Unix-domain sockets at file paths are not reliable on win32 (Node
  // supports them since 17 but Windows path semantics + the `\\.\pipe\`
  // requirement break our `tmpdir` assumption). Daemon is Unix-only for v1.
  if (process.platform === "win32") return true;
  if (argv.length === 0) return true;
  // `--agent --help` is intercepted in src/index.ts BEFORE commander
  // runs to emit a structured JSON help envelope. The daemon dispatch
  // would skip that interception and print textual help instead.
  if (argv.includes("--agent") && argv.includes("--help")) return true;
  const [top, sub] = topAndSub(argv);
  if (!top) return true;
  if (BYPASS_TOP_LEVEL.has(top)) return true;
  if (sub && BYPASS_NESTED.some(([p, s]) => p === top && s === sub))
    return true;
  if (looksLikeStdinFile(argv)) return true;
  return false;
}

/**
 * Try to dispatch via the daemon. Returns `true` only on a successful
 * exec response (in which case `process.exit` is called synchronously
 * with the captured exit code and the function never resolves to its
 * caller). Returns `false` on any failure → caller should run directly.
 *
 * Flow:
 *   0. Check the circuit breaker. If a previous call tripped it within
 *      the cooldown window, bypass the daemon entirely — no socket
 *      connect, no ping, no waiting. This is the safety net that
 *      makes "daemon broken → every call slow" impossible.
 *   1. Pre-flight ping (1s timeout). If the socket exists but the
 *      daemon doesn't pong, treat it as wedged: SIGKILL via the PID
 *      file, unlink the socket, fork a fresh daemon, and fall back
 *      to direct execution for THIS call.
 *   2. If the daemon's reported `cliVersion` doesn't match ours, ask
 *      it to shut down (it'll do so itself when we send exec, but a
 *      clean ping-driven respawn avoids the noisy version_mismatch
 *      reply path on the next call). Fall back to direct.
 *   3. Healthy daemon → dispatch the exec and proxy stdout/stderr.
 *      If the response deadline lapses or the daemon returns an
 *      internal error, trip the circuit breaker before falling back.
 */
export async function runWithDaemon(argv: string[]): Promise<boolean> {
  if (isCircuitBreakerTripped()) return false;
  const socketPath = defaultSocketPath();
  const health = await ensureHealthy(socketPath);
  if (health === "no-daemon") {
    // Fire-and-forget: pre-warm the daemon for the next call.
    spawnDaemon();
    return false;
  }
  if (health === "killed-and-respawned") {
    // We killed a wedged daemon and started a fresh one in the
    // background; THIS call still falls back to direct execution so
    // the user doesn't pay the cold-start tax twice.
    return false;
  }
  // health === "healthy" — proceed with exec.
  return attempt(socketPath, argv);
}

// ---------------------------------------------------------------------
// Circuit breaker
//
// Records a "daemon disabled until" UNIX timestamp at a per-user path.
// `runWithDaemon` reads it on every call and short-circuits if the
// daemon is in the penalty box. The file is intentionally a single
// integer string for fast (~50 µs) reads — anything heavier defeats
// the point of having a circuit breaker at all.
// ---------------------------------------------------------------------

/** Resolve the breaker file path. Override via env var for tests. */
export function defaultCircuitBreakerPath(): string {
  if (process.env.ANO_DAEMON_CIRCUIT_BREAKER_PATH)
    return process.env.ANO_DAEMON_CIRCUIT_BREAKER_PATH;
  const xdgCache = process.env.XDG_CACHE_HOME;
  const base = xdgCache ? xdgCache : join(homedir(), ".cache");
  return join(base, "ano", "daemon-disabled-until");
}

/**
 * Returns true if the breaker is tripped right now. Reads + parses the
 * timestamp file; missing/corrupt file means "not tripped".
 */
export function isCircuitBreakerTripped(now: number = Date.now()): boolean {
  const path = defaultCircuitBreakerPath();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  const ts = Number(raw.trim());
  if (!Number.isFinite(ts) || ts <= 0) return false;
  return ts > now;
}

/**
 * Trip the breaker until `now + CIRCUIT_BREAKER_COOLDOWN_MS`. Best
 * effort — a filesystem error here just means the next call attempts
 * the daemon again, which is acceptable degradation.
 */
export function tripCircuitBreaker(now: number = Date.now()): void {
  const path = defaultCircuitBreakerPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, String(now + CIRCUIT_BREAKER_COOLDOWN_MS), {
      mode: 0o600,
    });
  } catch {
    // Best effort — the cost of failing to write is one extra slow
    // call, which is exactly what the breaker is supposed to prevent.
    // No good way to surface this to the user without polluting
    // stderr on every CLI call. Daemon log would be appropriate; we
    // don't have a log channel from the client side yet.
  }
}

/** Clear the breaker. Used by `ano daemon start` and tests. */
export function clearCircuitBreaker(): void {
  try {
    unlinkSync(defaultCircuitBreakerPath());
  } catch {
    // already clear
  }
}

export type HealthResult = "healthy" | "no-daemon" | "killed-and-respawned";

/**
 * Pre-flight: connect + ping with a tight deadline, killing the daemon
 * if it doesn't pong in time. Catches every flavor of "daemon socket
 * exists but the process can't service requests" — wedged dispatch
 * loop, OOM thrash, partial protocol upgrade, OS sleep recovery, etc.
 *
 * Exported for tests; production callers go through `runWithDaemon`.
 */
export async function ensureHealthy(socketPath: string): Promise<HealthResult> {
  if (!existsSync(socketPath)) return "no-daemon";
  const ping = await pingDaemon(socketPath);
  if (ping.kind === "ok") {
    if (ping.cliVersion !== CLI_VERSION) {
      // Version drift — kill + respawn so the NEXT call gets a daemon
      // matching this client. Falling back this call avoids racing
      // the daemon's own self-shutdown (which only fires on `exec`,
      // not `ping`).
      forceKillDaemon(socketPath, ping.pid);
      spawnDaemon();
      return "killed-and-respawned";
    }
    return "healthy";
  }
  // ping.kind === "timeout" or "error" → daemon socket exists but
  // isn't replying. Force-cleanup and respawn.
  const pidFromFile = readPidFile();
  forceKillDaemon(socketPath, pidFromFile);
  spawnDaemon();
  return "killed-and-respawned";
}

type PingOutcome =
  | { kind: "ok"; pid: number; cliVersion: string }
  | { kind: "timeout" }
  | { kind: "error" };

function pingDaemon(socketPath: string): Promise<PingOutcome> {
  return new Promise((resolve) => {
    const sock = connect(socketPath);
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => done({ kind: "timeout" }), PING_TIMEOUT_MS);
    function done(result: PingOutcome): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      resolve(result);
    }
    sock.once("connect", () => {
      const req: PingRequest = { method: "ping", id: 0, v: PROTOCOL_VERSION };
      sock.write(frame(req));
    });
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      buffer += chunk;
      const nl = buffer.indexOf("\n");
      if (nl === -1) return;
      const line = buffer.slice(0, nl);
      try {
        const resp = JSON.parse(line) as DaemonResponse;
        if (resp.ok && "pong" in resp) {
          const p = resp as PingResponse;
          done({ kind: "ok", pid: p.pid, cliVersion: p.cliVersion });
          return;
        }
        // ok=false or unexpected shape → treat as broken.
        done({ kind: "error" });
      } catch {
        done({ kind: "error" });
      }
    });
    sock.on("error", () => done({ kind: "error" }));
  });
}

function readPidFile(): number | null {
  try {
    const raw = readFileSync(defaultPidPath(), "utf8").trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Force-cleanup a wedged daemon: SIGKILL the process (via PID file
 * if available) and unlink the stale socket so the next `connect()`
 * doesn't immediately succeed against an EBADF socket. Both steps
 * are best-effort — failures are swallowed because we're already in
 * the unhappy path.
 */
function forceKillDaemon(socketPath: string, pid: number | null): void {
  if (pid && pid > 0 && pid !== process.pid) {
    try {
      // SIGKILL — the daemon's own SIGTERM handler may itself be
      // wedged; we don't have time for a graceful drain.
      process.kill(pid, "SIGKILL");
    } catch {
      // Process may already be gone, or owned by another user.
    }
  }
  try {
    unlinkSync(socketPath);
  } catch {
    // Socket may already be gone (daemon cleaned up on exit).
  }
  try {
    unlinkSync(defaultPidPath());
  } catch {
    // ignore
  }
}

function attempt(socketPath: string, argv: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect(socketPath);
    let buffer = "";
    let settled = false;
    const connectTimer = setTimeout(() => cleanup(false), CONNECT_TIMEOUT_MS);
    /**
     * Response deadline. Tripping it is treated as a *daemon misbehavior*
     * signal: we (a) fall back to direct execution this call, (b) trip
     * the circuit breaker so the next 10 min of calls skip the daemon
     * entirely, and (c) SIGKILL the daemon so it can't keep producing
     * stale replies after the client has moved on.
     */
    const responseTimer = setTimeout(() => {
      onDaemonMisbehavior(socketPath, "response_timeout");
      cleanup(false);
    }, RESPONSE_TIMEOUT_MS);
    function cleanup(result: boolean): void {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(responseTimer);
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      resolve(result);
    }

    sock.once("connect", () => {
      clearTimeout(connectTimer);
      const req: ExecRequest = {
        method: "exec",
        id: 1,
        v: PROTOCOL_VERSION,
        cliVersion: CLI_VERSION,
        argv,
        cwd: process.cwd(),
        env: cleanEnv(),
      };
      sock.write(frame(req));
    });
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      buffer += chunk;
      const nl = buffer.indexOf("\n");
      if (nl === -1) return;
      const line = buffer.slice(0, nl);
      let resp: DaemonResponse;
      try {
        resp = JSON.parse(line) as DaemonResponse;
      } catch {
        cleanup(false);
        return;
      }
      if (!resp.ok) {
        // version_mismatch / shutdown_acked are legitimate daemon
        // signals — DON'T trip the breaker (the daemon is behaving
        // correctly, just declining this request). `internal` IS
        // a misbehavior signal (per the server's dispatch_timeout
        // code path); breaker trips.
        if (resp.code === "internal") {
          onDaemonMisbehavior(socketPath, "internal_error");
        }
        cleanup(false);
        return;
      }
      if ("stdout" in resp) {
        const r = resp as ExecResponse;
        if (r.stdout) process.stdout.write(r.stdout);
        if (r.stderr) process.stderr.write(r.stderr);
        // Synchronous exit; this Promise never resolves to the caller.
        process.exit(r.exitCode);
      }
      cleanup(false);
    });
    sock.on("error", () => cleanup(false));
  });
}

/**
 * Handle a daemon-misbehavior signal: trip the circuit breaker so the
 * next CIRCUIT_BREAKER_COOLDOWN_MS of calls skip the daemon, and
 * SIGKILL the daemon process so it can't keep producing stale replies.
 * Best effort throughout — failures here just degrade to "slow this
 * one call" which is acceptable.
 */
function onDaemonMisbehavior(
  socketPath: string,
  _reason: "response_timeout" | "internal_error",
): void {
  tripCircuitBreaker();
  const pid = readPidFile();
  forceKillDaemon(socketPath, pid);
}

/** `process.env` may contain `undefined` values per Node typings; strip them. */
function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function spawnDaemon(): void {
  const cmd = resolveDaemonSpawnCommand();
  if (!cmd) return;
  try {
    const child = spawn(cmd.command, cmd.args, {
      detached: true,
      stdio: "ignore",
      env: cleanEnv(),
    });
    child.unref();
  } catch {
    // best-effort; user can `ano daemon start` manually
  }
}

/**
 * Resolve how to re-spawn the daemon for this runtime.
 *
 * Two modes:
 *   • **Node** — `process.execPath` is `node`, `process.argv[1]` is the
 *     CLI script (dist/index.js). Spawn re-uses both:
 *       node /path/to/dist/index.js daemon serve
 *   • **Bun-compiled** — `process.execPath` IS the standalone binary;
 *     `process.argv[1]` points into Bun's embedded virtual filesystem
 *     (`/$bunfs/...`) which isn't useful as a spawn argument. Spawn
 *     the binary directly with the daemon args:
 *       /path/to/ano daemon serve
 *
 * Detection: `process.versions.bun` is set in both Bun-runtime and
 * Bun-compiled-binary contexts. Reliable across versions.
 */
function resolveDaemonSpawnCommand(): {
  command: string;
  args: string[];
} | null {
  if (process.versions.bun) {
    return { command: process.execPath, args: ["daemon", "serve"] };
  }
  const script = process.argv[1];
  if (!script) return null;
  return { command: process.execPath, args: [script, "daemon", "serve"] };
}
