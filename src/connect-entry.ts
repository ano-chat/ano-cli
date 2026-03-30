/**
 * Backward-compatible entry point for "npx ano-connect".
 * Preserves the exact same CLI interface as the original ano-connect package.
 */
import { Command } from "commander";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startBridge } from "./bridge/bridge.js";

const program = new Command()
  .name("ano-connect")
  .description(
    "Zero-config bridge for connecting AI agents to Ano (use `ano connect` instead)",
  )
  .requiredOption("-k, --key <key>", "Ano API key (ano_cwk_...)")
  .option("-e, --endpoint <url>", "Ano API endpoint", "https://api.ano.dev")
  .option("-w, --webhook <url>", "POST events as JSON to this URL")
  .option(
    "--webhook-secret <secret>",
    "Sent as X-Ano-Secret header on webhook POSTs",
  )
  .option(
    "--control-port <port>",
    "Start HTTP control server on this port (0 = OS-assigned)",
    parseInt,
  )
  .option(
    "--health-port <port>",
    "Start health server on this port (GET /healthz)",
    parseInt,
  )
  .option(
    "--openclaw <url>",
    "OpenClaw (or OpenAI-compatible) base URL — enables agent mode",
  )
  .option("--openclaw-token <token>", "Bearer token for OpenClaw auth")
  .option("--openclaw-agent <id>", "Agent ID for OpenClaw", "main")
  .action(
    async (opts: {
      key: string;
      endpoint: string;
      webhook?: string;
      webhookSecret?: string;
      controlPort?: number;
      healthPort?: number;
      openclaw?: string;
      openclawToken?: string;
      openclawAgent: string;
    }) => {
      // Deprecation notice (once)
      process.stderr.write(
        '[ano-connect] Note: Use "ano connect" instead. See https://github.com/LeoNilsson/ano-cli\n',
      );

      const endpoint = opts.endpoint.replace(/\/+$/, "");
      await startBridge({
        apiKey: opts.key,
        endpoint,
        webhookUrl: opts.webhook,
        webhookSecret: opts.webhookSecret,
        controlPort: opts.controlPort ?? (opts.webhook ? 0 : undefined),
        healthPort: opts.healthPort,
        openclawUrl: opts.openclaw?.replace(/\/+$/, ""),
        openclawToken: opts.openclawToken,
        openclawAgent: opts.openclawAgent,
      });
    },
  );

// install-service subcommand
program
  .command("install-service")
  .description("Install as a persistent system service")
  .option("-w, --webhook <url>", "POST events to this URL")
  .option("--webhook-secret <secret>", "Webhook secret header")
  .option("--control-port <port>", "Control server port", parseInt)
  .option("--health-port <port>", "Health server port", parseInt)
  .option("--openclaw <url>", "OpenClaw base URL")
  .option("--openclaw-token <token>", "OpenClaw auth token")
  .option("--openclaw-agent <id>", "Agent ID", "main")
  .action(async (opts, cmd) => {
    const parentOpts = cmd.parent?.opts() ?? {};
    const merged = { ...parentOpts, ...opts };
    const key = merged.key ?? process.env.ANO_API_KEY;
    if (!key) {
      console.error("Error: --key or ANO_API_KEY required.");
      process.exit(1);
    }
    const endpoint = (merged.endpoint ?? "https://api.ano.dev").replace(/\/+$/, "");

    const { installService } = await import("./bridge/service.js");
    await installService({
      key,
      endpoint,
      webhook: merged.webhook,
      webhookSecret: merged.webhookSecret,
      controlPort: merged.controlPort,
      healthPort: merged.healthPort,
      openclaw: (merged.openclaw as string | undefined)?.replace(/\/+$/, ""),
      openclawToken: merged.openclawToken,
      openclawAgent: merged.openclawAgent,
    });
  });

// uninstall-service subcommand
program
  .command("uninstall-service")
  .description("Remove an installed ano-connect system service")
  .option(
    "--service-name <name>",
    "Workspace name or 12-char hash (auto-detected if only one service exists)",
  )
  .action(async (opts) => {
    const { uninstallService } = await import("./bridge/service.js");

    let target = opts.serviceName;
    if (!target) {
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

program.parse();
