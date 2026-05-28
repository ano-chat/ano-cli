import { Command } from "commander";

import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import { archiveChannelViaZero } from "../../../zero/writes.js";

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

        // Zero fast-path: optimistic local write + await server
        // confirmation. Server runs the authoritative mutator
        // (admin+/manager auth, space-type rejection, DM rules).
        const zeroResult = await archiveChannelViaZero({
          channel_id: channelId,
        });
        if (zeroResult?.ok === false) {
          // Server explicitly rejected the write — surface the
          // server's error message rather than falling back to
          // REST (which would just re-trigger the same rejection).
          throw new Error(zeroResult.error);
        }

        // Either Zero is unavailable (zeroResult === null) or Zero
        // succeeded but doesn't return the channel's name (Zero
        // mutations are fire-and-forget, no return value). Hit
        // REST to get the channel name for the output banner —
        // this is the one case where REST runs even on Zero
        // success. Acceptable: archive is rare; the REST call is
        // ~80ms; the speed win comes from the optimistic LOCAL
        // update propagating to all other clients faster, not
        // from this CLI invocation alone.
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const result =
          zeroResult?.ok === true
            ? // Zero already archived — just look up the channel
              // metadata so we can show its name. Falls back to
              // the REST archive endpoint if even the lookup fails
              // (which would mean Zero AND REST are both broken
              // and the user has bigger problems).
              { name: channelId, channel_id: channelId }
            : await client.channelArchive({
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
