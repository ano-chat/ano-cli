import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { green, dim } from "../../../util/colors.js";

export function registerSetupOpenClaw(parent: Command): void {
  parent
    .command("openclaw")
    .description("Configure OpenClaw agent integration with Ano")
    .option("--openclaw-url <url>", "OpenClaw gateway URL")
    .option("--openclaw-token <token>", "OpenClaw auth token")
    .option("--health-port <port>", "Health server port", parseInt)
    .action(
      withErrorHandler(async (opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const ctx = await client.context();

        console.log(
          `${green("Connected")} to ${ctx.workspace.name} as ${ctx.user.name}`,
        );
        console.log();

        // Build the connect command
        const parts = [
          "ano connect",
          `--key ${auth.key.slice(0, 12)}...`,
        ];
        if (auth.endpoint !== "https://api.ano.dev") {
          parts.push(`--endpoint ${auth.endpoint}`);
        }
        if (opts.openclawUrl) {
          parts.push(`--openclaw ${opts.openclawUrl}`);
        }
        if (opts.openclawToken) {
          parts.push(`--openclaw-token <token>`);
        }
        if (opts.healthPort) {
          parts.push(`--health-port ${opts.healthPort}`);
        }

        console.log(`To start the agent bridge:`);
        console.log(`  ${dim(parts.join(" \\\n    "))}`);
        console.log();
        console.log(`To install as a persistent service:`);
        console.log(`  ${dim("ano connect install-service --key <key> --openclaw <url>")}`);
        console.log();
        console.log(`To verify:`);
        console.log(`  ${dim("ano doctor")}`);
      }),
    );
}
