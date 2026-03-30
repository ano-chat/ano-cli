import { Command } from "commander";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GlobalOptions } from "../../types.js";
import { startBridge } from "../../../bridge/bridge.js";

export function registerConnect(parent: Command): void {
  const group = new Command("connect")
    .description("Start real-time SSE bridge to Ano")
    .option("--webhook <url>", "POST events to this URL")
    .option("--webhook-secret <secret>", "Webhook secret header")
    .option("--control-port <port>", "Control server port", parseInt)
    .option("--health-port <port>", "Health server port", parseInt)
    .option("--openclaw <url>", "OpenClaw base URL — enables agent mode")
    .option("--openclaw-token <token>", "OpenClaw auth token")
    .option("--openclaw-agent <id>", "Agent ID", "main")
    .action(async (opts, cmd) => {
      const globals = cmd.optsWithGlobals() as GlobalOptions;
      const key = globals.key ?? process.env.ANO_API_KEY;
      if (!key) {
        console.error(
          "Error: --key or ANO_API_KEY required. Run `ano auth login` first.",
        );
        process.exit(3);
      }

      const endpoint = globals.endpoint.replace(/\/+$/, "");
      await startBridge({
        apiKey: key,
        endpoint,
        webhookUrl: opts.webhook,
        webhookSecret: opts.webhookSecret,
        controlPort:
          opts.controlPort ?? (opts.webhook ? 0 : undefined),
        healthPort: opts.healthPort,
        openclawUrl: opts.openclaw?.replace(/\/+$/, ""),
        openclawToken: opts.openclawToken,
        openclawAgent: opts.openclawAgent,
      });
    });

  // install-service
  group
    .command("install-service")
    .description("Install as persistent system service")
    .option("--webhook <url>", "POST events to this URL")
    .option("--webhook-secret <secret>", "Webhook secret")
    .option("--control-port <port>", "Control server port", parseInt)
    .option("--health-port <port>", "Health server port", parseInt)
    .option("--openclaw <url>", "OpenClaw base URL")
    .option("--openclaw-token <token>", "OpenClaw auth token")
    .option("--openclaw-agent <id>", "Agent ID", "main")
    .action(async (opts, cmd) => {
      const globals = cmd.optsWithGlobals() as GlobalOptions;
      const parentOpts = cmd.parent?.opts() ?? {};
      const merged = { ...parentOpts, ...opts };
      const key = globals.key ?? process.env.ANO_API_KEY;
      if (!key) {
        console.error("Error: --key or ANO_API_KEY required.");
        process.exit(3);
      }

      const { installService } = await import(
        "../../../bridge/service.js"
      );
      await installService({
        key,
        endpoint: globals.endpoint.replace(/\/+$/, ""),
        webhook: merged.webhook,
        webhookSecret: merged.webhookSecret,
        controlPort: merged.controlPort,
        healthPort: merged.healthPort,
        openclaw: (merged.openclaw as string | undefined)?.replace(/\/+$/, ""),
        openclawToken: merged.openclawToken,
        openclawAgent: merged.openclawAgent,
      });
    });

  // uninstall-service
  group
    .command("uninstall-service")
    .description("Remove installed service")
    .option(
      "--service-name <name>",
      "Workspace name or 12-char hash (auto-detected if only one service exists)",
    )
    .action(async (opts) => {
      const { uninstallService } = await import(
        "../../../bridge/service.js"
      );

      let target = opts.serviceName;
      if (!target) {
        // Auto-detect installed services
        const home = homedir();
        const platform = process.platform;
        const services: string[] = [];

        if (platform === "darwin") {
          const plistDir = join(home, "Library", "LaunchAgents");
          try {
            const files = readdirSync(plistDir);
            for (const f of files) {
              const m = f.match(/^dev\.ano\.connect\.([a-f0-9]{12})\.plist$/);
              if (m) services.push(m[1]);
            }
          } catch { /* dir may not exist */ }
        } else if (platform === "linux") {
          const unitDir = join(home, ".config", "systemd", "user");
          try {
            const files = readdirSync(unitDir);
            for (const f of files) {
              const m = f.match(/^ano-connect-([a-f0-9]{12})\.service$/);
              if (m) services.push(m[1]);
            }
          } catch { /* dir may not exist */ }
        }

        if (services.length === 0) {
          console.error("No ano-connect services found.");
          process.exit(1);
        } else if (services.length === 1) {
          target = services[0];
          console.error(`Auto-detected service: ${target}`);
        } else {
          console.error("Multiple services found. Specify one with --service-name:");
          for (const s of services) {
            console.error(`  ${s}`);
          }
          process.exit(1);
        }
      }

      await uninstallService(target);
    });

  parent.addCommand(group);
}
