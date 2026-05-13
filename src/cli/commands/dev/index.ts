/**
 * `ano dev` — developer-only commands. Currently `dev smoke` runs a
 * tight sanity sweep against the active profile so you know in <500 ms
 * whether your CLI/server change broke a canonical workflow.
 *
 * Bypassed by the daemon client just like `daemon`/`auth login` —
 * `dev smoke` reports daemon state in its summary, so it must run in
 * the calling process to read the right profile + env vars.
 */
import { Command } from "commander";
import { connect } from "node:net";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { defaultSocketPath } from "../../../daemon/protocol.js";
import { bold, cyan, dim, green, red } from "../../../util/colors.js";

interface SmokeStep {
  name: string;
  status: "pass" | "fail";
  ms: number;
  detail?: string;
  error?: string;
}

export function registerDev(parent: Command): void {
  const dev = parent
    .command("dev")
    .description("Developer-only commands (smoke tests, perf probes)");

  dev
    .command("smoke")
    .description("Run canonical CLI operations and report timings")
    .option(
      "-c, --channel-name <name>",
      "Channel to send the smoke message to (default: first messageable channel)",
    )
    .option(
      "--no-write",
      "Skip the message-send step (read-only smoke against rate-limited envs)",
    )
    .action(
      withErrorHandler(async (opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const wantWrite = opts.write !== false;
        const overrideChannel: string | undefined = opts.channelName;

        const steps: SmokeStep[] = [];
        const totalStart = performance.now();

        // 1. context — validates auth + workspace membership
        await time(steps, "context", async () => {
          const ctx = await client.context();
          return `${ctx.workspace.name} · ${ctx.user.name}`;
        });

        // 2. channels list — also gives us a target for the write step.
        // Pick a "least surprising" target: prefer `test-history`, then
        // any `test-*` channel, then `random`, then the first messageable.
        // This keeps smoke writes out of business-relevant channels.
        let firstChannelId: string | null = null;
        let firstChannelName: string | null = null;
        await time(steps, "channels list", async () => {
          const r = await client.listChannels();
          const messageable = r.channels.filter((c) => c.type !== "space");
          const pick =
            messageable.find((c) => c.name === "test-history") ??
            messageable.find((c) => c.name.startsWith("test-")) ??
            messageable.find((c) => c.name === "random") ??
            messageable[0];
          if (pick) {
            firstChannelId = pick.id;
            firstChannelName = pick.name;
          }
          return `${r.channels.length} channels`;
        });

        // 3. users list
        await time(steps, "users list", async () => {
          const r = await client.listUsers();
          return `${r.users.length} users`;
        });

        // 4. tables list
        await time(steps, "tables list", async () => {
          const r = await client.listTables();
          const len = Array.isArray(r) ? r.length : 0;
          return `${len} tables`;
        });

        // 5. messages send — exercises the new --channel-name path when
        //    available, otherwise falls back to channel_id.
        if (wantWrite) {
          const targetName = overrideChannel ?? firstChannelName;
          if (!targetName && !firstChannelId) {
            steps.push({
              name: "messages send",
              status: "fail",
              ms: 0,
              error: "no messageable channel found — pass --channel-name",
            });
          } else {
            const stamp = new Date().toISOString().replace(/[:.]/g, "-");
            const content = `dev:smoke ${stamp}`;
            await time(steps, "messages send", async () => {
              const sent = await client.sendMessage({
                channel_name: targetName ?? undefined,
                channel_id: targetName
                  ? undefined
                  : (firstChannelId ?? undefined),
                content,
              });
              return `→ ${sent.message_id} (#${targetName ?? firstChannelName ?? "?"})`;
            });
          }
        }

        const totalMs = Math.round(performance.now() - totalStart);
        const passed = steps.filter((s) => s.status === "pass").length;
        const allGood = passed === steps.length;
        const daemonState = await probeDaemon();

        if (globals.agent || globals.json) {
          process.stdout.write(
            JSON.stringify(
              {
                ok: allGood,
                steps,
                total_ms: totalMs,
                passed,
                total: steps.length,
                daemon: daemonState,
                endpoint: auth.endpoint,
              },
              null,
              2,
            ) + "\n",
          );
        } else {
          for (const s of steps) {
            const mark = s.status === "pass" ? green("✓") : red("✗");
            const tail = s.detail ? ` ${dim(s.detail)}` : "";
            const msTxt = `${String(s.ms).padStart(4)}ms`;
            const line = `${mark} ${s.name.padEnd(16)} ${msTxt}${tail}`;
            process.stdout.write(line + "\n");
            if (s.error) process.stdout.write(`    ${red(s.error)}\n`);
          }
          const banner = allGood
            ? green("all green")
            : red(`${steps.length - passed} FAILED`);
          const dState = daemonState.running
            ? cyan(
                `daemon: warm (pid ${daemonState.pid}, v${daemonState.cliVersion})`,
              )
            : dim("daemon: cold");
          process.stdout.write(
            `${bold(banner)} · ${passed}/${steps.length} in ${totalMs}ms · ${dState}\n`,
          );
          process.stdout.write(dim(`endpoint: ${auth.endpoint}\n`));
        }

        if (!allGood) process.exit(1);
      }),
    );
}

async function time(
  steps: SmokeStep[],
  name: string,
  fn: () => Promise<string | undefined>,
): Promise<void> {
  const t0 = performance.now();
  try {
    const detail = await fn();
    steps.push({
      name,
      status: "pass",
      ms: Math.round(performance.now() - t0),
      detail,
    });
  } catch (err) {
    steps.push({
      name,
      status: "fail",
      ms: Math.round(performance.now() - t0),
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

interface DaemonProbe {
  running: boolean;
  pid?: number;
  cliVersion?: string;
}

/** Best-effort daemon ping (200 ms timeout). Reported in the summary. */
function probeDaemon(): Promise<DaemonProbe> {
  return new Promise((resolve) => {
    const sock = connect(defaultSocketPath());
    let buffer = "";
    let settled = false;
    const done = (state: DaemonProbe): void => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      resolve(state);
    };
    const timer = setTimeout(() => done({ running: false }), 200);
    sock.once("connect", () => {
      sock.write(JSON.stringify({ method: "ping", id: 1, v: 1 }) + "\n");
    });
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      buffer += chunk;
      const nl = buffer.indexOf("\n");
      if (nl === -1) return;
      clearTimeout(timer);
      try {
        const r = JSON.parse(buffer.slice(0, nl)) as {
          ok?: boolean;
          pid?: number;
          cliVersion?: string;
        };
        done({ running: r.ok === true, pid: r.pid, cliVersion: r.cliVersion });
      } catch {
        done({ running: false });
      }
    });
    sock.on("error", () => {
      clearTimeout(timer);
      done({ running: false });
    });
  });
}
