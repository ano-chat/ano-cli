/**
 * Backward-compatible entry point for "npx ano-connect".
 * Preserves the exact same CLI interface as the original ano-connect package.
 */
import { Command } from "commander";
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
  .requiredOption("-k, --key <key>", "Ano API key (ano_cwk_...)")
  .option("-e, --endpoint <url>", "Ano API endpoint", "https://api.ano.dev")
  .option("-w, --webhook <url>", "POST events to this URL")
  .option("--webhook-secret <secret>", "Webhook secret header")
  .option("--control-port <port>", "Control server port", parseInt)
  .option("--health-port <port>", "Health server port", parseInt)
  .option("--openclaw <url>", "OpenClaw base URL")
  .option("--openclaw-token <token>", "OpenClaw auth token")
  .option("--openclaw-agent <id>", "Agent ID", "main")
  .action(async (opts) => {
    const { installService } = await import("./bridge/service.js");
    await installService({
      key: opts.key,
      endpoint: opts.endpoint.replace(/\/+$/, ""),
      webhook: opts.webhook,
      webhookSecret: opts.webhookSecret,
      controlPort: opts.controlPort,
      healthPort: opts.healthPort,
      openclaw: opts.openclaw?.replace(/\/+$/, ""),
      openclawToken: opts.openclawToken,
      openclawAgent: opts.openclawAgent,
    });
  });

// uninstall-service subcommand
program
  .command("uninstall-service")
  .description("Remove an installed ano-connect system service")
  .requiredOption(
    "--workspace <name>",
    "Workspace name or 12-char service hash",
  )
  .action(async (opts) => {
    const { uninstallService } = await import("./bridge/service.js");
    await uninstallService(opts.workspace);
  });

program.parse();
