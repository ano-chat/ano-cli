/**
 * ano-daemon server — listens on a Unix socket, dispatches `ano <cmd>`
 * invocations through the same `commander` machinery the standalone CLI
 * uses, and returns captured stdout/stderr/exitCode to the client.
 *
 * Lifecycle:
 *   • Spawned detached by the daemon client (or `ano daemon start`).
 *   • Writes its PID to `defaultPidPath()` for `ano daemon status`.
 *   • Resets the idle timer on every request; exits after DEFAULT_IDLE_MS
 *     of silence so it doesn't camp memory forever.
 *   • Single-request dispatcher (queue) — no cross-request bleed on
 *     captured stdout/stderr/cwd/env.
 *
 * Capture: overrides process.stdout.write, process.stderr.write, and
 * process.exit for the duration of each dispatch. Anything the command
 * code writes via console.log / process.stdout / process.stderr / throws
 * via process.exit is buffered, packaged into the response, then state
 * is restored.
 *
 * Skipped scenarios: anything needing TTY interaction or stdin is rejected
 * by the client BEFORE the request reaches the daemon (see client.ts).
 * If one slips through and process.stdin is read here, the daemon would
 * hang — guard rails live on the client side.
 */
import { createServer, type Server, type Socket } from "node:net";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  DEFAULT_IDLE_MS,
  PROTOCOL_VERSION,
  defaultPidPath,
  defaultSocketPath,
  frame,
  type DaemonRequest,
  type DaemonResponse,
  type ExecRequest,
} from "./protocol.js";
import { createProgram } from "../cli/root.js";
import { registerAllCommands } from "../cli/register.js";

declare const __VERSION__: string;
const DAEMON_CLI_VERSION =
  typeof __VERSION__ !== "undefined" ? __VERSION__ : "0.0.0-dev";

/**
 * Per-dispatch timeout. If a single command exceeds this we reply to the
 * client with an error, then `process.exit(1)` so the next call gets a
 * fresh daemon. Pre-2.13.1 the dispatch chain could deadlock when one
 * dispatch hung (server rate-limit retries, an awaited fetch that never
 * resolved, etc.) — every queued request behind it then blocked too.
 * Suicide + respawn is heavy-handed but bulletproof: state can't bleed
 * across daemons.
 */
const DISPATCH_TIMEOUT_MS = 60_000;

class ExitSentinel extends Error {
  constructor(public readonly code: number) {
    super("daemon-exit-sentinel");
  }
}

interface DispatchResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run one client request inside a fresh commander program. State is
 * restored before returning, so the next request sees a clean process.
 */
async function dispatch(req: ExecRequest): Promise<DispatchResult> {
  const stdoutBuf: string[] = [];
  const stderrBuf: string[] = [];
  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const origExit = process.exit.bind(process);
  const origCwd = process.cwd();
  const origEnv = { ...process.env };

  // Stub stdout/stderr to buffer + drop. (We forward back over the socket
  // — writing to the daemon's TTY would just spam wherever the daemon was
  // started.) `Buffer` and string both stringify cleanly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stdout.write = ((chunk: any) => {
    stdoutBuf.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stderr.write = ((chunk: any) => {
    stderrBuf.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    return true;
  }) as typeof process.stderr.write;
  // commander calls process.exit on parse errors; capture as control flow.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.exit = ((code?: number) => {
    throw new ExitSentinel(code ?? 0);
  }) as any;

  // Apply caller's cwd + env. If chdir fails (deleted dir), skip.
  try {
    if (existsSync(req.cwd)) process.chdir(req.cwd);
  } catch {
    // ignore
  }
  // Replace env wholesale to mirror the caller's shell exactly. Restore in finally.
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, req.env);

  let exitCode = 0;
  try {
    const program = createProgram();
    registerAllCommands(program);
    // commander's `from: "user"` skips the conventional [node, script]
    // shift — req.argv is exactly the user-typed args.
    await program.parseAsync(req.argv, { from: "user" });
  } catch (err) {
    if (err instanceof ExitSentinel) {
      exitCode = err.code;
    } else {
      const message =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      stderrBuf.push(message + "\n");
      exitCode = 1;
    }
  } finally {
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;
    process.exit = origExit;
    try {
      process.chdir(origCwd);
    } catch {
      // ignore
    }
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, origEnv);
  }

  return {
    stdout: stdoutBuf.join(""),
    stderr: stderrBuf.join(""),
    exitCode,
  };
}

/**
 * Pump a single client connection: read newline-delimited frames,
 * dispatch each, write response. Closes when the client disconnects or
 * a shutdown request is received.
 */
function attachConnection(socket: Socket, ctx: ServerContext): void {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", async (chunk) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      ctx.bumpIdle();
      let req: DaemonRequest;
      try {
        req = JSON.parse(line) as DaemonRequest;
      } catch {
        continue;
      }
      const reply = (resp: DaemonResponse): void => {
        socket.write(frame(resp));
      };
      if (req.v !== PROTOCOL_VERSION) {
        reply({
          id: req.id,
          ok: false,
          error: `Daemon protocol v${PROTOCOL_VERSION}; client sent v${req.v}. Restart daemon (\`ano daemon stop\`) and try again.`,
          code: "version_mismatch",
        });
        continue;
      }
      if (req.method === "ping") {
        reply({
          id: req.id,
          ok: true,
          pong: true,
          pid: process.pid,
          startedAt: ctx.startedAt,
          v: PROTOCOL_VERSION,
          cliVersion: DAEMON_CLI_VERSION,
        });
        continue;
      }
      if (req.method === "shutdown") {
        reply({
          id: req.id,
          ok: false,
          error: "shutting down",
          code: "shutdown_acked",
        });
        // Defer so the response actually flushes before the process exits.
        setTimeout(() => ctx.shutdown(), 50);
        continue;
      }
      if (req.method === "exec") {
        // Reject mismatched CLI versions: the user upgraded the binary
        // but this daemon is running the old code. Self-shutdown after
        // replying so the next call gets a daemon matching the new CLI.
        if (req.cliVersion && req.cliVersion !== DAEMON_CLI_VERSION) {
          reply({
            id: req.id,
            ok: false,
            error: `Daemon CLI v${DAEMON_CLI_VERSION}; client is v${req.cliVersion}. Restarting.`,
            code: "version_mismatch",
          });
          setTimeout(() => ctx.shutdown(), 50);
          continue;
        }
        // Queue; serial dispatch with per-dispatch timeout.
        ctx.queue = ctx.queue.then(async () => {
          const t0 = performance.now();
          let timedOut = false;
          let timer: NodeJS.Timeout | null = null;
          try {
            const r = await Promise.race([
              ctx.dispatchFn(req),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                  timedOut = true;
                  reject(new Error("dispatch_timeout"));
                }, ctx.dispatchTimeoutMs);
              }),
            ]);
            if (timer) clearTimeout(timer);
            reply({
              id: req.id,
              ok: true,
              stdout: r.stdout,
              stderr: r.stderr,
              exitCode: r.exitCode,
              dispatchMs: Math.round(performance.now() - t0),
            });
          } catch (err) {
            if (timer) clearTimeout(timer);
            const message =
              err instanceof Error ? (err.stack ?? err.message) : String(err);
            reply({
              id: req.id,
              ok: false,
              error: timedOut
                ? `Dispatch exceeded ${ctx.dispatchTimeoutMs}ms; daemon restarting.`
                : message,
              code: "internal",
            });
            if (timedOut) {
              // Force respawn — the in-flight dispatch is orphaned; we
              // can't safely cancel it, but exiting the process flushes
              // any leaked timers/connections it may be holding. The
              // client falls back to direct execution and opportunistic
              // spawn restores a clean daemon.
              setTimeout(() => ctx.shutdown(), 50);
            }
          }
        });
        continue;
      }
      reply({
        id: (req as { id: number }).id,
        ok: false,
        error: `unknown method`,
        code: "unknown_method",
      });
    }
  });
  socket.on("error", () => {
    // ECONNRESET is normal when client exits mid-stream; nothing to do.
  });
}

interface ServerContext {
  server: Server;
  startedAt: number;
  /** Serial dispatch chain — every exec extends it. */
  queue: Promise<void>;
  /** Resolved per-dispatch timeout, ms. Captured at startDaemon() time. */
  dispatchTimeoutMs: number;
  /** The dispatch implementation. Production = `dispatch`; tests override. */
  dispatchFn: (req: ExecRequest) => Promise<DispatchResult>;
  bumpIdle: () => void;
  shutdown: () => void;
}

export interface DaemonStartOptions {
  socketPath?: string;
  pidPath?: string;
  /** Idle window in ms. 0 disables idle exit (useful for tests). */
  idleMs?: number;
  /**
   * Per-dispatch timeout in ms. Tests override this to a small value to
   * exercise the timeout + suicide-respawn path quickly.
   */
  dispatchTimeoutMs?: number;
  /**
   * INTERNAL — replace the dispatch function. Only used by tests to
   * simulate a hung command without touching the real command tree. Do
   * not use from production code.
   */
  _dispatchOverride?: (req: ExecRequest) => Promise<DispatchResult>;
  /**
   * INTERNAL — replace `process.exit(0)` at shutdown so tests can
   * trigger the suicide-respawn path without killing the vitest worker.
   */
  _onShutdown?: () => void;
}

/**
 * Start the daemon. Returns a handle for graceful shutdown; in normal
 * operation the daemon shuts itself down on idle or `ano daemon stop`.
 */
export function startDaemon(opts: DaemonStartOptions = {}): {
  socketPath: string;
  shutdown: () => void;
} {
  const socketPath = opts.socketPath ?? defaultSocketPath();
  const pidPath = opts.pidPath ?? defaultPidPath();
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;

  // Clean up a stale socket left behind by a previous daemon that died
  // without unlinking. `EADDRINUSE` later means a live daemon is already
  // bound; we'll detect that on listen() and exit cleanly.
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath);
    } catch {
      // ignore — listen() will surface the real error
    }
  }
  mkdirSync(dirname(socketPath), { recursive: true });

  const ctx: ServerContext = {
    server: createServer((s) => attachConnection(s, ctx)),
    startedAt: Date.now(),
    queue: Promise.resolve(),
    dispatchTimeoutMs: opts.dispatchTimeoutMs ?? DISPATCH_TIMEOUT_MS,
    dispatchFn: opts._dispatchOverride ?? dispatch,
    bumpIdle: () => {},
    shutdown: () => {},
  };

  let idleTimer: NodeJS.Timeout | null = null;
  ctx.bumpIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    if (idleMs > 0) {
      idleTimer = setTimeout(() => ctx.shutdown(), idleMs);
      idleTimer.unref();
    }
  };
  ctx.shutdown = (): void => {
    try {
      ctx.server.close();
    } catch {
      // ignore
    }
    try {
      unlinkSync(socketPath);
    } catch {
      // ignore
    }
    try {
      unlinkSync(pidPath);
    } catch {
      // ignore
    }
    if (opts._onShutdown) opts._onShutdown();
    else process.exit(0);
  };

  ctx.server.listen(socketPath, () => {
    // Restrict to owner-only — the socket lets you run any `ano` command
    // as the daemon's user. `Server.listen` on a path doesn't accept a
    // mode arg, so chmod after bind.
    try {
      chmodSync(socketPath, 0o600);
    } catch {
      // ignore — best effort
    }
    writeFileSync(pidPath, String(process.pid), { mode: 0o600 });
    ctx.bumpIdle();
  });
  ctx.server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      // Another daemon is already bound — let that one win.
      process.exit(0);
    }
    // Anything else is fatal.
    // eslint-disable-next-line no-console
    console.error("[ano-daemon] listen error:", err);
    process.exit(1);
  });

  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(sig, () => ctx.shutdown());
  }

  return {
    socketPath,
    shutdown: ctx.shutdown,
  };
}
