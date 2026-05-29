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
 *   status   — full health check: CLI, profile/auth, daemon, Zero
 *              replica + drift, cache, and a LIVE API probe, with an
 *              overall verdict. The "is everything working in prod?"
 *              dashboard.
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
import type { GlobalOptions } from "../../types.js";
import { resolveAuth, type ResolvedAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import { green, red, yellow, dim, bold } from "../../../util/colors.js";

declare const __VERSION__: string;

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
    .description(
      "Full health check: CLI, auth, daemon, Zero replica, and live API",
    )
    .action(async (_opts: unknown, cmd: Command) => {
      const globals = cmd.optsWithGlobals() as GlobalOptions;
      const health = await gatherHealth(globals);

      if (globals.json || globals.agent || globals.quiet) {
        output(globals, {
          data: health,
          breadcrumbs: [
            {
              action: "daemon_start",
              cmd: "ano daemon start",
              description: "Start / warm the daemon",
            },
            {
              action: "auth_login",
              cmd: "ano auth login --key <key>",
              description: "Re-authenticate",
            },
          ],
        });
      } else {
        process.stdout.write(renderHealth(health) + "\n");
      }
      // Non-zero exit on a hard failure (auth/API down) so scripts and
      // agents can gate on `ano daemon status`. Warnings stay exit 0.
      if (health.verdict.status === "fail") process.exit(1);
    });
}

// ──────────────────────────────────────────────────────────────────────────
// Health model
// ──────────────────────────────────────────────────────────────────────────

export interface ZeroHealth {
  enabled: boolean;
  status?: string;
  replicaBytes?: number | null;
  drifted: Array<{ table: string; reason: string }>;
  offReason?: string;
  readsVerdict: string;
  fast: boolean;
}

export interface HealthReport {
  cli: {
    version: string;
    runtime: string;
    daemonVersion?: string;
    stale: boolean;
  };
  profile: { endpoint: string; region: string } | null;
  auth: { ok: boolean; keyPrefix?: string; source?: string; error?: string };
  daemon: {
    running: boolean;
    pid?: number;
    uptimeMs?: number;
    proto?: number;
    socket: string;
    breaker: boolean;
  };
  cache?: {
    entries: number;
    origins: number;
    hits: number;
    misses: number;
    rate: string;
  };
  zero: ZeroHealth;
  api: {
    ok: boolean;
    endpoint: string;
    workspace?: string;
    members?: number;
    identity?: string;
    role?: string;
    channels?: number;
    error?: string;
  };
  verdict: { status: "pass" | "warn" | "fail"; summary: string };
}

async function gatherHealth(globals: GlobalOptions): Promise<HealthReport> {
  const version =
    typeof __VERSION__ !== "undefined" ? __VERSION__ : "0.0.0-dev";
  const runtime = process.versions.bun
    ? `native ${process.arch}`
    : `node ${process.version}`;

  // Auth / profile (resolved in this process; same resolution the daemon uses)
  let auth: HealthReport["auth"] = { ok: false };
  let profile: HealthReport["profile"] = null;
  let resolved: ResolvedAuth | null = null;
  try {
    resolved = resolveAuth(globals);
    auth = {
      ok: true,
      keyPrefix: resolved.key.slice(0, 12),
      source: resolved.source,
    };
    profile = {
      endpoint: resolved.endpoint,
      region: deriveRegion(resolved.endpoint),
    };
  } catch (err) {
    auth = { ok: false, error: (err as Error).message };
  }

  // Daemon ping
  const socketPath = defaultSocketPath();
  const ping = await sendOnce<PingRequest>({
    method: "ping",
    id: 1,
    v: PROTOCOL_VERSION,
  });
  let daemon: HealthReport["daemon"] = {
    running: false,
    socket: socketPath,
    breaker: isCircuitBreakerTripped(),
  };
  let cache: HealthReport["cache"];
  let zeroRaw: PingResponse["zero"] | undefined;
  let daemonVersion: string | undefined;
  if (ping && ping.ok && "pong" in ping) {
    const r = ping as PingResponse;
    daemon = {
      running: true,
      pid: r.pid,
      uptimeMs: Date.now() - r.startedAt,
      proto: r.v,
      socket: socketPath,
      breaker: isCircuitBreakerTripped(),
    };
    daemonVersion = r.cliVersion;
    if (r.cache) {
      const total = r.cache.hits + r.cache.misses;
      cache = {
        entries: r.cache.entries,
        origins: r.cache.origins,
        hits: r.cache.hits,
        misses: r.cache.misses,
        rate:
          total === 0 ? "—" : `${Math.round((r.cache.hits / total) * 100)}%`,
      };
    }
    zeroRaw = r.zero;
  }

  const zero = computeZeroHealth(daemon.running, zeroRaw);

  // Live API probe (REST) — proves auth + connectivity + workspace in prod.
  let api: HealthReport["api"] = {
    ok: false,
    endpoint: profile?.endpoint ?? "(unknown)",
    error: "skipped (no auth)",
  };
  if (resolved) {
    try {
      const ctx = await createApiClient(resolved).context();
      api = {
        ok: true,
        endpoint: resolved.endpoint,
        workspace: ctx.workspace.name,
        members: ctx.workspace.member_count,
        identity: ctx.user.name,
        role: ctx.user.role,
        channels: ctx.channels.length,
      };
    } catch (err) {
      api = {
        ok: false,
        endpoint: resolved.endpoint,
        error: (err as Error).message,
      };
    }
  }

  const cli = {
    version,
    runtime,
    daemonVersion,
    stale: !!daemonVersion && daemonVersion !== version,
  };
  const verdict = computeVerdict({ auth, daemon, zero, api, cli });
  return { cli, profile, auth, daemon, cache, zero, api, verdict };
}

// ── pure helpers (unit-tested in index.test.ts) ──────────────────────────

export function deriveRegion(endpoint: string): string {
  try {
    const h = new URL(endpoint).hostname;
    if (h === "localhost" || h === "127.0.0.1") return "local";
    if (h === "api.ano.dev") return "apex(!)";
    const m = h.match(/^api-([a-z0-9]+)\.ano\.dev$/);
    if (m) return m[1];
    return "?";
  } catch {
    return "?";
  }
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function computeZeroHealth(
  daemonRunning: boolean,
  zeroRaw: PingResponse["zero"] | undefined,
): ZeroHealth {
  if (!daemonRunning) {
    return {
      enabled: false,
      drifted: [],
      offReason: "daemon not running",
      readsVerdict: "cold — next call spawns daemon + hydrates (~379ms)",
      fast: false,
    };
  }
  if (!zeroRaw) {
    return {
      enabled: false,
      drifted: [],
      offReason: "bootstrap failed or ANO_DISABLE_ZERO set",
      readsVerdict: "REST only (no local replica)",
      fast: false,
    };
  }
  const drifted = zeroRaw.drifted ?? [];
  if (drifted.length > 0) {
    return {
      enabled: true,
      status: zeroRaw.status,
      replicaBytes: zeroRaw.replicaSizeBytes,
      drifted,
      readsVerdict: `partial REST fallback — drift on ${drifted
        .map((d) => d.table)
        .join(", ")}`,
      fast: false,
    };
  }
  const connected = zeroRaw.status === "connected";
  return {
    enabled: true,
    status: zeroRaw.status,
    replicaBytes: zeroRaw.replicaSizeBytes,
    drifted,
    readsVerdict: connected
      ? "warm local replica (~39ms)"
      : `replica ${zeroRaw.status} — reads may fall back to REST`,
    fast: connected,
  };
}

export function computeVerdict(p: {
  auth: HealthReport["auth"];
  daemon: HealthReport["daemon"];
  zero: ZeroHealth;
  api: HealthReport["api"];
  cli: HealthReport["cli"];
}): HealthReport["verdict"] {
  if (!p.auth.ok) {
    return { status: "fail", summary: "Auth failed — run 'ano auth login'" };
  }
  if (!p.api.ok) {
    return { status: "fail", summary: `API unreachable — ${p.api.error}` };
  }
  const warns: string[] = [];
  if (!p.daemon.running) warns.push("daemon down (cold reads)");
  if (p.daemon.breaker) warns.push("circuit breaker tripped");
  if (!p.zero.fast)
    warns.push(p.zero.enabled ? "reads on REST fallback" : "Zero replica off");
  if (p.cli.stale) warns.push(`daemon stale (v${p.cli.daemonVersion})`);
  if (warns.length > 0) {
    return { status: "warn", summary: `Degraded — ${warns.join("; ")}` };
  }
  return { status: "pass", summary: "All systems go — prod fast path healthy" };
}

function renderHealth(h: HealthReport): string {
  const pad = (s: string): string => s.padEnd(10);
  const L: string[] = [bold("ano daemon status"), ""];

  // ── CLI / profile / auth ──
  const staleNote = h.cli.stale
    ? yellow(` ⚠ daemon on v${h.cli.daemonVersion} (restarts on next call)`)
    : "";
  L.push(`${pad("CLI")} v${h.cli.version} · ${h.cli.runtime}${staleNote}`);
  if (h.profile) {
    L.push(
      `${pad("Profile")} ${h.profile.endpoint} (region ${h.profile.region})`,
    );
  }
  L.push(
    h.auth.ok
      ? `${pad("Auth")} ${green("✓")} ${h.auth.keyPrefix}… ${dim(`(source: ${h.auth.source})`)}`
      : `${pad("Auth")} ${red("✗")} ${h.auth.error}`,
  );
  L.push("");

  // ── daemon / cache ──
  L.push(
    h.daemon.running
      ? `${pad("Daemon")} ${green("✓")} running · pid ${h.daemon.pid} · up ${formatDuration(h.daemon.uptimeMs ?? 0)} · proto v${h.daemon.proto}`
      : `${pad("Daemon")} ${yellow("⚠")} not running ${dim("(next call cold-spawns ~379ms)")}`,
  );
  if (h.daemon.breaker) {
    L.push(
      `${pad("")} ${yellow("⚠")} breaker TRIPPED — calls bypass daemon; run 'ano daemon start'`,
    );
  }
  if (h.cache) {
    L.push(
      `${pad("Cache")} ${h.cache.entries} entries/${h.cache.origins} origin${h.cache.origins === 1 ? "" : "s"} · ${h.cache.hits} hits/${h.cache.misses} misses (${h.cache.rate})`,
    );
  }

  // ── Zero replica / reads ──
  if (h.zero.enabled) {
    const driftNote =
      h.zero.drifted.length > 0
        ? yellow(
            `⚠ drift: ${h.zero.drifted.map((d) => d.table).join(", ")} (REST fallback)`,
          )
        : dim("no drift");
    L.push(
      `${pad("Zero")} ${green("✓")} ${h.zero.status} · replica ${formatBytes(h.zero.replicaBytes)} · ${driftNote}`,
    );
  } else {
    L.push(`${pad("Zero")} ${yellow("⚠")} off ${dim(`(${h.zero.offReason})`)}`);
  }
  L.push(
    `${pad("Reads")} ${h.zero.fast ? green("✓") : yellow("⚠")} ${h.zero.readsVerdict}`,
  );
  L.push("");

  // ── live API ──
  if (h.api.ok) {
    L.push(`${pad("API")} ${green("✓")} ${h.api.endpoint} reachable`);
    L.push(`${pad("Workspace")} ${h.api.workspace} · ${h.api.members} members`);
    L.push(`${pad("Identity")} ${h.api.identity} · ${h.api.role}`);
    L.push(`${pad("Channels")} ${green("✓")} ${h.api.channels} accessible`);
  } else {
    L.push(`${pad("API")} ${red("✗")} ${h.api.endpoint} — ${h.api.error}`);
  }
  L.push("");

  // ── verdict ──
  const vIcon =
    h.verdict.status === "pass"
      ? green("✓")
      : h.verdict.status === "warn"
        ? yellow("⚠")
        : red("✗");
  L.push(`${pad("Verdict")} ${vIcon} ${h.verdict.summary}`);
  return L.join("\n");
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
