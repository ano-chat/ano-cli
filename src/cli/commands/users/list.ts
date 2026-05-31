import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import { listUsersViaZero } from "../../../zero/reads.js";

export function registerListUsers(parent: Command): void {
  parent
    .command("list")
    .description("List workspace members")
    .action(
      withErrorHandler(async (_opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const workspace_id = globals.workspace ?? auth.workspace_id;
        const zeroResult = await listUsersViaZero({
          workspace_id,
        });
        const result =
          zeroResult ??
          (await (async () => {
            const client = createApiClient(auth);
            return await client.listUsers({
              workspace_id,
            });
          })());

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
