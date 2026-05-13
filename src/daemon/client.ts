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
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { connect } from "node:net";
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
 * Exec response deadline. Drops the prior 30s window to 10s — the
 * daemon's own per-dispatch timeout is 60s, but the client doesn't
 * need to wait that long: a dispatch that's still running after 10s
 * is overwhelmingly likely to be a wedge or runaway. Pre-flight ping
 * already weeded out unresponsive daemons.
 */
const RESPONSE_TIMEOUT_MS = 10 * 1000;

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
 *   1. Pre-flight ping (1s timeout). If the socket exists but the
 *      daemon doesn't pong, treat it as wedged: SIGKILL via the PID
 *      file, unlink the socket, fork a fresh daemon, and fall back
 *      to direct execution for THIS call. The previous design just
 *      waited the full 30s exec timeout for a reply that never came.
 *   2. If the daemon's reported `cliVersion` doesn't match ours, ask
 *      it to shut down (it'll do so itself when we send exec, but a
 *      clean ping-driven respawn avoids the noisy version_mismatch
 *      reply path on the next call). Fall back to direct.
 *   3. Healthy daemon → dispatch the exec and proxy stdout/stderr.
 */
export async function runWithDaemon(argv: string[]): Promise<boolean> {
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
    const responseTimer = setTimeout(() => cleanup(false), RESPONSE_TIMEOUT_MS);
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
        // version_mismatch / internal / shutdown_acked — fall back.
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

/** `process.env` may contain `undefined` values per Node typings; strip them. */
function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function spawnDaemon(): void {
  const node = process.execPath;
  const script = process.argv[1]; // dist/index.js when installed
  if (!script) return;
  try {
    const child = spawn(node, [script, "daemon", "serve"], {
      detached: true,
      stdio: "ignore",
      env: cleanEnv(),
    });
    child.unref();
  } catch {
    // best-effort; user can `ano daemon start` manually
  }
}
