import { Command } from "commander";

import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

/**
 * `ano channels member-remove <channel-id> <user-id>` — wraps manifest
 * `channel_member_remove`. Soft-delete (sets removed_at + removed_by).
 * Reversible via `member-add`. Self-removal is blocked server-side
 * — use channel `leave` instead.
 */
export function registerChannelMemberRemove(parent: Command): void {
  parent
    .command("member-remove <channel-id> <user-id>")
    .description(
      "Remove a user from a channel (soft delete; reversible via member-add).",
    )
    .action(
      withErrorHandler(
        async (channelId: string, userId: string, _opts, cmd) => {
          const globals = cmd.optsWithGlobals() as GlobalOptions;
          const auth = resolveAuth(globals);
          const client = createApiClient(auth);

          const result = await client.channelMemberRemove({
            channel_id: channelId,
            user_id: userId,
            workspace_id: globals.workspace,
          });

          output(globals, {
            data: result,
            title: `Removed ${userId} from channel ${channelId}`,
            breadcrumbs: [
              {
                action: "member_add",
                cmd: `ano channels member-add ${channelId} ${userId}`,
                description: "Re-add the member if removed by mistake",
              },
            ],
          });
        },
      ),
    );
}
