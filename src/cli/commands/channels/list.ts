import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

export function registerListChannels(parent: Command): void {
  parent
    .command("list")
    .description("List channels in the workspace")
    .action(
      withErrorHandler(async (_opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const result = await client.listChannels({
          workspace_id: globals.workspace,
        });

        output(globals, {
          data: result.channels,
          columns: ["id", "name", "type", "topic"],
          title: "Channels",
          breadcrumbs: [
            {
              action: "read_messages",
              cmd: "ano messages read --channel <id>",
              description: "Read messages from a channel",
            },
            {
              action: "send_message",
              cmd: 'ano messages send --channel <id> "Hello"',
              description: "Send a message to a channel",
            },
            {
              action: "list_users",
              cmd: "ano users list",
              description: "List workspace members",
            },
          ],
        });
      }),
    );
}
