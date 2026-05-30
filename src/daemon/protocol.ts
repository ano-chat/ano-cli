/**
 * ano-daemon protocol — newline-delimited JSON over a Unix domain socket.
 *
 * Goal: keep the same Node process warm across many `ano <cmd>`
 * invocations so the agent doesn't pay the ~140 ms cold-start tax on
 * every call. Speed-up-cli-shell investigation, Candidate E.
 *
 * Wire format: one JSON object per line (`\n` terminator). Both sides
 * frame requests + responses the same way. No length prefix; no
 * fragmentation handling beyond "buffer until newline".
 *
 * Concurrency: the server dispatches requests serially. Multiple clients
 * can connect simultaneously; their requests queue at the dispatcher.
 */
import { homedir } from "node:os";
import { join } from "node:path";

/** Latest protocol version. Daemon and client must agree on major. */
export const PROTOCOL_VERSION = 1;

/**
 * Resolve the per-user socket path. This MUST be stable across every context
 * that invokes the CLI for a given user, or the whole "keep one warm daemon"
 * premise collapses.
 *
 * Resolution order:
 *   1. `ANO_DAEMON_SOCKET` — explicit override (tests, exotic setups).
 *   2. `XDG_RUNTIME_DIR` (Linux) — the correct per-user runtime dir
 *      (`/run/user/<uid>`, tmpfs, cleaned on logout). Stable, so fine.
 *   3. `~/.cache/ano/daemon-<uid>.sock` — the home-anchored fallback.
 *
 * We deliberately do NOT use `os.tmpdir()` here. `os.tmpdir()` honors the
 * `$TMPDIR` env var, which launchers routinely override: Claude Code sets
 * `TMPDIR=/tmp/claude-<uid>`, ssh/cron/launchd get `/tmp`, and a macOS GUI
 * login session gets `/var/folders/.../T/`. Each distinct `$TMPDIR` produced a
 * different socket, so every context spawned its OWN daemon with its OWN Zero
 * replica instead of sharing one warm replica — re-paying the ~370ms cold
 * spawn + hydration ramp on every context switch, and leaking daemons. The
 * home dir is the same regardless of `$TMPDIR`, so all of a user's contexts
 * now converge on one socket. `~/.cache/ano` already houses the daemon log
 * (see `defaultLogPath`), and `runDaemon` mkdir -p's the socket's parent
 * before binding, so no new directory plumbing is needed.
 */
export function defaultSocketPath(): string {
  if (process.env.ANO_DAEMON_SOCKET) return process.env.ANO_DAEMON_SOCKET;
  const uid = process.getuid?.() ?? 0;
  const xdgRuntime = process.env.XDG_RUNTIME_DIR;
  if (xdgRuntime) return join(xdgRuntime, "ano-daemon.sock");
  return join(homedir(), ".cache", "ano", `daemon-${uid}.sock`);
}

/** PID file used by `ano daemon status` to detect a stale socket. */
export function defaultPidPath(): string {
  return defaultSocketPath() + ".pid";
}

/** Log file path; daemon redirects its own stdout/stderr here. */
export function defaultLogPath(): string {
  return join(homedir(), ".cache", "ano", "daemon.log");
}

/**
 * Idle exit window — the daemon shuts itself down after this many ms with no
 * requests, so an abandoned daemon doesn't linger forever holding ~80MB.
 *
 * Raised from the original 10 min to 60 min: a routine lull (a meeting, lunch,
 * a long build) was killing the warm replica, so the next interaction re-paid
 * the ~370ms cold spawn + hydration ramp. 60 min covers normal work gaps while
 * still reaping a truly-abandoned daemon within the hour.
 */
export const DEFAULT_IDLE_MS = 60 * 60 * 1000;

/**
 * Resolve the idle-exit window, honoring `ANO_DAEMON_IDLE_MS` (milliseconds).
 * A value of `0` disables idle exit entirely — for an always-on agent host or
 * a launchd/systemd keep-warm unit. Unset, empty, or non-finite/negative input
 * falls back to {@link DEFAULT_IDLE_MS}.
 */
export function resolveIdleMs(): number {
  const raw = process.env.ANO_DAEMON_IDLE_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_IDLE_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_IDLE_MS;
  return n;
}

export interface ExecRequest {
  /** Always "exec" for command dispatch. */
  method: "exec";
  /** Caller-assigned correlation id. */
  id: number;
  /** Daemon protocol version. Mismatched majors → server returns error. */
  v: number;
  /**
   * The calling CLI binary's version. The daemon compares this against
   * its own bundled __VERSION__; on mismatch it returns
   * `version_mismatch` and self-shuts-down so the next call spawns a
   * fresh daemon matching the new CLI. Without this, an upgraded CLI
   * would keep talking to a stale daemon until manually restarted.
   */
  cliVersion: string;
  /** Argv as the user typed it (no node/script prefix). */
  argv: string[];
  /** Caller's working directory; daemon temporarily chdirs to it per request. */
  cwd: string;
  /** Caller's env. Merged over the daemon's; per-request scope. */
  env: Record<string, string>;
}

export interface ShutdownRequest {
  method: "shutdown";
  id: number;
  v: number;
}

export interface PingRequest {
  method: "ping";
  id: number;
  v: number;
}

export type DaemonRequest = ExecRequest | ShutdownRequest | PingRequest;

export interface ExecResponse {
  id: number;
  ok: true;
  /** Captured bytes the dispatched command wrote to its stdout. */
  stdout: string;
  /** Captured bytes for stderr. */
  stderr: string;
  /** Exit code the dispatched command would have returned. */
  exitCode: number;
  /** Daemon-side wall time for the dispatch, ms. Surfaces in --debug. */
  dispatchMs: number;
}

export interface PingResponse {
  id: number;
  ok: true;
  pong: true;
  pid: number;
  startedAt: number;
  v: number;
  /** CLI version bundled into this daemon process. */
  cliVersion: string;
  /**
   * In-process response-cache stats. Optional so older daemons can omit
   * it without breaking the v1 protocol — newer clients render the
   * field if present. Resets on daemon restart.
   */
  cache?: {
    hits: number;
    misses: number;
    invalidations: number;
    origins: number;
    entries: number;
  };
  /**
   * Local Zero replica state. Optional so older daemons (Zero disabled
   * or feature-flagged off) just omit it.
   */
  zero?: {
    /** Connection status, e.g. "connected", "connecting", "needs-auth". */
    status: string;
    /** Absolute path of the SQLite replica file on disk. */
    replicaPath: string;
    /** Size of the replica file in bytes, or null if not yet bootstrapped. */
    replicaSizeBytes: number | null;
    /**
     * Tables flagged as schema-drifted (vendored CLI schema disagrees
     * with what the server's data actually returns). Reads on these
     * tables skip Zero and fall back to REST. Optional so older daemons
     * (or fresh daemons with no drift detected) just omit it.
     */
    drifted?: Array<{ table: string; reason: string }>;
  };
}

export interface DaemonError {
  id: number;
  ok: false;
  error: string;
  /** Stable code the client uses to decide fallback vs. surface. */
  code:
    | "version_mismatch"
    | "unknown_method"
    | "internal"
    | "shutdown_acked"
    | "stdin_unsupported";
}

export type DaemonResponse = ExecResponse | PingResponse | DaemonError;

/** Serialise + frame a JSON value as one line. Always ends with `\n`. */
export function frame(value: unknown): string {
  return JSON.stringify(value) + "\n";
}
