import { Command } from "commander";

import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

/**
 * `ano workspaces member-remove <workspace-id> <user-id>` — wraps
 * manifest `workspace_member_remove`. Soft-delete via `removed_at` +
 * `removed_by`. Reversible via `member-add`. Forbidden against the
 * workspace's primary_owner.
 */
export function registerWorkspaceMemberRemove(parent: Command): void {
  parent
    .command("member-remove <workspace-id> <user-id>")
    .description(
      "Soft-remove a user from a workspace. Reversible via member-add.",
    )
    .action(
      withErrorHandler(
        async (workspaceId: string, userId: string, _opts, cmd) => {
          const globals = cmd.optsWithGlobals() as GlobalOptions;
          const auth = resolveAuth(globals);
          const client = createApiClient(auth);

          const result = await client.workspaceMemberRemove({
            workspace_id: workspaceId,
            user_id: userId,
          });

          output(globals, {
            data: result,
            title: `Removed ${userId} from workspace ${workspaceId}`,
            breadcrumbs: [
              {
                action: "rejoin_member",
                cmd: `ano workspaces member-add ${workspaceId} ${userId}`,
                description: "Reverse the removal (rejoin)",
              },
            ],
          });
        },
      ),
    );
}
