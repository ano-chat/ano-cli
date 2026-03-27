import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

export function registerListUsers(parent: Command): void {
  parent
    .command("list")
    .description("List workspace members")
    .action(
      withErrorHandler(async (_opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const result = await client.listUsers({
          workspace_id: globals.workspace,
        });

        output(globals, {
          data: result.users,
          columns: ["id", "display_name", "email"],
          title: "Users",
          breadcrumbs: [
            {
              action: "send_dm",
              cmd: 'ano dm send --to "<name>" "Hello"',
              description: "Send a DM to a user",
            },
            {
              action: "list_channels",
              cmd: "ano channels list",
              description: "List channels",
            },
          ],
        });
      }),
    );
}
