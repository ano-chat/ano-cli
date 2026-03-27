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
    .requiredOption("-k, --key <key>", "API key (ano_cwk_...)")
    .option(
      "-e, --endpoint <url>",
      "API endpoint",
      "https://api.ano.dev",
    )
    .option("-p, --profile <name>", "Profile name", "default")
    .action(
      withErrorHandler(async (opts) => {
        // Validate the key by calling context
        const client = createApiClient({
          key: opts.key,
          endpoint: opts.endpoint,
          source: "flag",
        });
        const ctx = await client.context();

        // Save credentials
        const creds = loadGlobalCredentials() ?? { profiles: {} };
        creds.profiles[opts.profile] = {
          key: opts.key,
          endpoint:
            opts.endpoint !== "https://api.ano.dev"
              ? opts.endpoint
              : undefined,
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
