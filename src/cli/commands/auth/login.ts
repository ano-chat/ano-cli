import { Command } from "commander";
import { withErrorHandler } from "../../middleware/error-handler.js";
import {
  saveGlobalCredentials,
  loadGlobalCredentials,
} from "../../../core/config.js";
import { createApiClient } from "../../../core/api-client.js";
import { green } from "../../../util/colors.js";

export function registerAuthLogin(parent: Command): void {
  parent
    .command("login")
    .description("Save an API key for authentication")
    .option("-p, --profile <name>", "Profile name", "default")
    .action(
      withErrorHandler(async (opts, cmd) => {
        // Read key and endpoint from global options (root defines -k, --key and -e, --endpoint)
        const globals = cmd.optsWithGlobals();
        const key = globals.key ?? process.env.ANO_API_KEY;
        if (!key) {
          console.error(
            "Error: --key or ANO_API_KEY required. Usage: ano -k <key> auth login",
          );
          process.exit(1);
        }
        const endpoint = globals.endpoint ?? "https://api.ano.dev";

        // Validate the key by calling context
        const client = createApiClient({
          key,
          endpoint,
          source: "flag",
        });
        const ctx = await client.context();

        // Save credentials
        const creds = loadGlobalCredentials() ?? { profiles: {} };
        creds.profiles[opts.profile] = {
          key,
          endpoint:
            endpoint !== "https://api.ano.dev" ? endpoint : undefined,
          workspace_name: ctx.workspace.name,
          created_at: new Date().toISOString(),
        };
        saveGlobalCredentials(creds);

        console.log(
          `${green("Authenticated")} as ${ctx.user.name} in ${ctx.workspace.name}`,
        );
        console.log(
          `Profile "${opts.profile}" saved to ~/.config/ano/credentials.json`,
        );
      }),
    );
}
