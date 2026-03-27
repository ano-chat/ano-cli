import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { startBridge } from "../../../bridge/bridge.js";

export function registerConnect(parent: Command): void {
  const group = new Command("connect")
    .description("Start real-time SSE bridge to Ano")
    .option("-w, --webhook <url>", "POST events to this URL")
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
    .option("-w, --webhook <url>", "POST events to this URL")
    .option("--webhook-secret <secret>", "Webhook secret")
    .option("--control-port <port>", "Control server port", parseInt)
    .option("--health-port <port>", "Health server port", parseInt)
    .option("--openclaw <url>", "OpenClaw base URL")
    .option("--openclaw-token <token>", "OpenClaw auth token")
    .option("--openclaw-agent <id>", "Agent ID", "main")
    .action(async (opts, cmd) => {
      const globals = cmd.optsWithGlobals() as GlobalOptions;
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
        webhook: opts.webhook,
        webhookSecret: opts.webhookSecret,
        controlPort: opts.controlPort,
        healthPort: opts.healthPort,
        openclaw: opts.openclaw?.replace(/\/+$/, ""),
        openclawToken: opts.openclawToken,
        openclawAgent: opts.openclawAgent,
      });
    });

  // uninstall-service
  group
    .command("uninstall-service")
    .description("Remove installed service")
    .requiredOption(
      "--workspace <name>",
      "Workspace name or 12-char hash",
    )
    .action(async (opts) => {
      const { uninstallService } = await import(
        "../../../bridge/service.js"
      );
      await uninstallService(opts.workspace);
    });

  parent.addCommand(group);
}
