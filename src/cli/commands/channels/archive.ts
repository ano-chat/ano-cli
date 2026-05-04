import { Command } from "commander";

import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

/**
 * `ano channels archive <channel-id>` — wraps manifest `channel_archive`
 * op. Caller must be a workspace admin or channel manager. Marked
 * destructive in the op, so MCP clients can prompt; CLI shows a clear
 * confirmation in the output.
 */
export function registerChannelArchive(parent: Command): void {
  parent
    .command("archive <channel-id>")
    .description(
      "Archive a channel (sets is_archived=true). Reversible from the desktop UI.",
    )
    .action(
      withErrorHandler(async (channelId: string, _opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        const result = await client.channelArchive({
          channel_id: channelId,
          workspace_id: globals.workspace,
        });

        output(globals, {
          data: result,
          title: `#${result.name} archived`,
          breadcrumbs: [
            {
              action: "list_channels",
              cmd: "ano channels list --agent",
              description:
                "Confirm the channel is no longer in the active list",
            },
          ],
        });
      }),
    );
}
