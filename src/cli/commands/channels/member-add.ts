import { Command } from "commander";

import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

/**
 * `ano channels member-add <channel-id> <user-id>` — wraps manifest
 * `channel_member_add`. Idempotent — re-adding a previously-removed
 * member rejoins them.
 */
export function registerChannelMemberAdd(parent: Command): void {
  parent
    .command("member-add <channel-id> <user-id>")
    .description(
      "Add a user to a channel. Idempotent (rejoin clears removed_at).",
    )
    .action(
      withErrorHandler(
        async (channelId: string, userId: string, _opts, cmd) => {
          const globals = cmd.optsWithGlobals() as GlobalOptions;
          const auth = resolveAuth(globals);
          const client = createApiClient(auth);

          const result = await client.channelMemberAdd({
            channel_id: channelId,
            user_id: userId,
            workspace_id: globals.workspace,
          });

          output(globals, {
            data: result,
            title: `Added ${userId} to channel ${channelId}`,
            breadcrumbs: [
              {
                action: "send_message",
                cmd: `ano messages send "Welcome aboard" --channel ${channelId}`,
                description: "Greet the new member",
              },
            ],
          });
        },
      ),
    );
}
