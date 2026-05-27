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
import {
  clearCircuitBreaker,
  isCircuitBreakerTripped,
} from "../../../daemon/client.js";

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
      // Two runtime modes:
      //   • Node — `process.execPath` is `node`, `argv[1]` is the
      //     installed CLI script; spawn re-uses both.
      //   • Bun-compiled — `process.execPath` IS the standalone
      //     binary; `argv[1]` is Bun's virtual-fs entry which can't be
      //     passed to spawn. Spawn the binary directly.
      // `process.versions.bun` is set in both Bun-runtime and
      // Bun-compiled contexts. Detector matches src/daemon/client.ts.
      const command = process.execPath;
      const args = process.versions.bun
        ? ["daemon", "serve"]
        : process.argv[1]
          ? [process.argv[1], "daemon", "serve"]
          : null;
      if (!args) {
        process.stderr.write(
          "ano daemon start: cannot resolve daemon script path\n",
        );
        process.exit(1);
      }
      // An explicit `ano daemon start` is the user telling us they want
      // the daemon back. Clear any prior circuit-breaker trip so the
      // next CLI call actually tries the daemon instead of bypassing it.
      clearCircuitBreaker();
      const child = spawn(command, args, {
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
        const lines = [
          `status:  running`,
          `pid:     ${r.pid}`,
          `socket:  ${socketPath}`,
          `uptime:  ${formatDuration(uptimeMs)}`,
          `cli:     v${r.cliVersion}`,
          `proto:   v${r.v}`,
        ];
        if (r.cache) {
          // Daemon reports its own in-process cache stats. Useful for
          // verifying the cache is doing useful work in the wild.
          // Hit rate is 0/0 → "—" so a fresh daemon doesn't print
          // misleading "0%".
          const total = r.cache.hits + r.cache.misses;
          const rate =
            total === 0 ? "—" : `${Math.round((r.cache.hits / total) * 100)}%`;
          lines.push(
            `cache:   ${r.cache.entries} entries across ${r.cache.origins} origin${r.cache.origins === 1 ? "" : "s"}; ${r.cache.hits} hits / ${r.cache.misses} misses (${rate}); ${r.cache.invalidations} invalidations`,
          );
        }
        if (r.zero) {
          // Zero replica status: connection state + replica file size
          // so the user can verify Zero is actually doing useful work.
          const sizeBytes = r.zero.replicaSizeBytes;
          const sizeStr =
            sizeBytes === null
              ? "—"
              : sizeBytes < 1024
                ? `${sizeBytes} B`
                : sizeBytes < 1024 * 1024
                  ? `${Math.round(sizeBytes / 1024)} KB`
                  : `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
          lines.push(`zero:    ${r.zero.status} (replica: ${sizeStr})`);
        }
        if (isCircuitBreakerTripped()) {
          // The daemon answered ping but a prior call tripped the
          // breaker — surface that explicitly so the user knows CLI
          // calls are currently bypassing this daemon. `ano daemon
          // start` clears the breaker.
          lines.push(
            `breaker: TRIPPED (CLI calls bypass daemon; run \`ano daemon start\` to clear)`,
          );
        }
        process.stdout.write(lines.join("\n") + "\n");
        return;
      }
      // Daemon didn't reply. Tell the user what we COULD see, so they
      // don't have to guess. A "not running" daemon can fail in three
      // distinguishable ways and the user wants different responses
      // for each:
      //
      //   • Breaker tripped → daemon was force-killed by client after
      //     a slow/misbehaving call; will auto-reopen in 10 min, or
      //     `ano daemon start` clears it now.
      //   • Stale pid/socket file → daemon crashed without cleanup;
      //     next CLI call will respawn. Files are decorative now.
      //   • Nothing → daemon never started; `ano daemon start` starts
      //     it OR the next CLI call auto-spawns it.
      const lines = [`status:  not running`];
      if (isCircuitBreakerTripped()) {
        lines.push(
          `breaker: TRIPPED — CLI calls bypass daemon until cooldown expires`,
        );
        lines.push(
          `         run \`ano daemon start\` to clear the breaker and respawn`,
        );
      }
      if (existsSync(pidPath)) {
        try {
          const stalePid = readFileSync(pidPath, "utf8").trim();
          lines.push(
            `orphan:  ${pidPath} (pid ${stalePid}) — daemon died without cleanup`,
          );
        } catch {
          lines.push(`orphan:  ${pidPath} (pid unreadable)`);
        }
      }
      if (existsSync(socketPath)) {
        lines.push(`orphan:  ${socketPath} — stale socket file`);
      }
      // No diagnostic context = pristine state, just no daemon.
      // Suggest the obvious next move.
      if (lines.length === 1) {
        lines.push(
          `         run \`ano daemon start\` or just \`ano <cmd>\` (auto-spawns)`,
        );
      }
      process.stdout.write(lines.join("\n") + "\n");
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
