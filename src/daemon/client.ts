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
import { existsSync } from "node:fs";
import { connect } from "node:net";
import {
  PROTOCOL_VERSION,
  defaultSocketPath,
  frame,
  type DaemonResponse,
  type ExecRequest,
  type ExecResponse,
} from "./protocol.js";

declare const __VERSION__: string;
const CLI_VERSION =
  typeof __VERSION__ !== "undefined" ? __VERSION__ : "0.0.0-dev";

const CONNECT_TIMEOUT_MS = 150;
const RESPONSE_TIMEOUT_MS = 30 * 1000;

const BYPASS_TOP_LEVEL = new Set(["daemon"]);
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
 */
export async function runWithDaemon(argv: string[]): Promise<boolean> {
  const socketPath = defaultSocketPath();
  const handled = await attempt(socketPath, argv);
  if (!handled && !existsSync(socketPath)) {
    // Fire-and-forget: pre-warm the daemon for the next call. Detached
    // so the parent shell doesn't wait, stdio ignored so we don't leak
    // file descriptors.
    spawnDaemon();
  }
  return handled;
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
