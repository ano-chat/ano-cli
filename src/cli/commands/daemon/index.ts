/**
 * `ano daemon` — control the long-lived background process that holds
 * the warm Node bundle for fast subsequent CLI calls. Speed-up-cli-shell
 * Candidate E.
 *
 * Subcommands:
 *   serve    — internal: start the daemon in this process. The shim
 *              spawns this detached when no daemon is running.
 *   start    — user-facing: spawn a detached daemon, return.
 *   stop     — send a shutdown RPC to a running daemon.
 *   status   — ping the daemon, report PID + uptime, or "not running".
 *
 * `ano daemon` itself always bypasses the daemon path in client.ts, so
 * these commands run in the calling process directly.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import type { Command } from "commander";
import {
  PROTOCOL_VERSION,
  defaultPidPath,
  defaultSocketPath,
  frame,
  type DaemonResponse,
  type PingResponse,
  type ShutdownRequest,
  type PingRequest,
} from "../../../daemon/protocol.js";
import { startDaemon } from "../../../daemon/server.js";

export function registerDaemon(parent: Command): void {
  const group = parent
    .command("daemon")
    .description(
      "Manage the ano-daemon background process for faster CLI calls",
    );

  group
    .command("serve")
    .description("Run the daemon in the foreground (internal use)")
    .action(() => {
      startDaemon();
      // startDaemon returns immediately — process stays alive on the
      // socket listener. Keep the event loop pinned via stdin so the
      // node process doesn't exit if no listeners are attached.
      // (The socket listener does keep the loop alive in practice;
      // this is belt-and-suspenders.)
    });

  group
    .command("start")
    .description("Start the daemon detached, return immediately")
    .action(() => {
      const node = process.execPath;
      const script = process.argv[1];
      if (!script) {
        process.stderr.write(
          "ano daemon start: cannot resolve daemon script path\n",
        );
        process.exit(1);
      }
      const child = spawn(node, [script, "daemon", "serve"], {
        detached: true,
        stdio: "ignore",
        env: process.env,
      });
      child.unref();
      process.stdout.write(`ano-daemon spawned (pid ${child.pid})\n`);
    });

  group
    .command("stop")
    .description("Stop the running daemon")
    .action(async () => {
      const ok = await sendOnce<ShutdownRequest>({
        method: "shutdown",
        id: 1,
        v: PROTOCOL_VERSION,
      });
      if (ok) process.stdout.write("ano-daemon shutdown requested\n");
      else process.stdout.write("ano-daemon not running\n");
    });

  group
    .command("status")
    .description("Show whether the daemon is running")
    .action(async () => {
      const socketPath = defaultSocketPath();
      const pidPath = defaultPidPath();
      const ping = await sendOnce<PingRequest>({
        method: "ping",
        id: 1,
        v: PROTOCOL_VERSION,
      });
      if (ping && ping.ok && "pong" in ping) {
        const r = ping as PingResponse;
        const uptimeMs = Date.now() - r.startedAt;
        process.stdout.write(
          [
            `status:  running`,
            `pid:     ${r.pid}`,
            `socket:  ${socketPath}`,
            `uptime:  ${formatDuration(uptimeMs)}`,
            `cli:     v${r.cliVersion}`,
            `proto:   v${r.v}`,
          ].join("\n") + "\n",
        );
        return;
      }
      // Stale pid file? Report it so the user knows what to clean up.
      let stale = "";
      if (existsSync(pidPath)) {
        try {
          stale = ` (stale pid ${readFileSync(pidPath, "utf8").trim()})`;
        } catch {
          // ignore
        }
      }
      process.stdout.write(`status: not running${stale}\n`);
    });
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/**
 * Send a single RPC and resolve to the parsed response, or null if no
 * daemon is reachable. Used by `stop` and `status`.
 */
function sendOnce<R extends { id: number }>(
  req: R & { method: string; v: number },
): Promise<DaemonResponse | null> {
  return new Promise((resolve) => {
    const sock = connect(defaultSocketPath());
    let buffer = "";
    let settled = false;
    const done = (r: DaemonResponse | null): void => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      resolve(r);
    };
    const timer = setTimeout(() => done(null), 500);
    sock.once("connect", () => sock.write(frame(req)));
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      buffer += chunk;
      const nl = buffer.indexOf("\n");
      if (nl === -1) return;
      clearTimeout(timer);
      try {
        done(JSON.parse(buffer.slice(0, nl)) as DaemonResponse);
      } catch {
        done(null);
      }
    });
    sock.on("error", () => {
      clearTimeout(timer);
      done(null);
    });
  });
}
