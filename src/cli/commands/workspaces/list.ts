import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

export function registerListWorkspaces(parent: Command): void {
  parent
    .command("list")
    .description("List workspaces")
    .action(
      withErrorHandler(async (_opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const result = await client.listWorkspaces();

        output(globals, {
          data: result.workspaces,
          columns: ["id", "name"],
          title: "Workspaces",
          breadcrumbs: [
            {
              action: "list_channels",
              cmd: "ano channels list",
              description: "List channels in a workspace",
            },
          ],
        });
      }),
    );
}
