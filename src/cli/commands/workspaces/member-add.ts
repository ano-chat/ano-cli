import { Command } from "commander";

import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

/**
 * `ano workspaces member-add <workspace-id> <user-id>` — wraps manifest
 * `workspace_member_add`. Idempotent: rejoins removed members and
 * promotes 'collaborator' role to 'member'. Auto-joins public channels.
 */
export function registerWorkspaceMemberAdd(parent: Command): void {
  parent
    .command("member-add <workspace-id> <user-id>")
    .description(
      "Add a user to a workspace as a full member. Auto-joins public channels.",
    )
    .action(
      withErrorHandler(
        async (workspaceId: string, userId: string, _opts, cmd) => {
          const globals = cmd.optsWithGlobals() as GlobalOptions;
          const auth = resolveAuth(globals);
          const client = createApiClient(auth);

          const result = await client.workspaceMemberAdd({
            workspace_id: workspaceId,
            user_id: userId,
          });

          const summary = result.already_member
            ? `Already a member`
            : result.rejoined
              ? `Rejoined (was previously removed)`
              : result.promoted_from_collaborator
                ? `Promoted from collaborator → member`
                : `Added as new member`;

          output(globals, {
            data: result,
            title: `${summary}: ${userId} in workspace ${workspaceId}`,
          });
        },
      ),
    );
}
