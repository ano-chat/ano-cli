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
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** Latest protocol version. Daemon and client must agree on major. */
export const PROTOCOL_VERSION = 1;

/**
 * Resolve the per-user socket path. macOS `os.tmpdir()` returns a
 * `/var/folders/...` path that's already user-private; Linux uses
 * `XDG_RUNTIME_DIR` if set, else `${tmpdir}/ano-daemon-${uid}`.
 */
export function defaultSocketPath(): string {
  if (process.env.ANO_DAEMON_SOCKET) return process.env.ANO_DAEMON_SOCKET;
  const uid = process.getuid?.() ?? 0;
  const xdgRuntime = process.env.XDG_RUNTIME_DIR;
  if (xdgRuntime) return join(xdgRuntime, "ano-daemon.sock");
  return join(tmpdir(), `ano-daemon-${uid}.sock`);
}

/** PID file used by `ano daemon status` to detect a stale socket. */
export function defaultPidPath(): string {
  return defaultSocketPath() + ".pid";
}

/** Log file path; daemon redirects its own stdout/stderr here. */
export function defaultLogPath(): string {
  return join(homedir(), ".cache", "ano", "daemon.log");
}

/** Idle exit window — daemon shuts itself down after this many ms with no requests. */
export const DEFAULT_IDLE_MS = 10 * 60 * 1000;

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
