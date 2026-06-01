import { Command } from "commander";
import type { DmConversation } from "../../../core/api-client.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import { resolveAuth } from "../../../core/auth.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import type { GlobalOptions } from "../../types.js";
import { parseDmLimit } from "./recipients.js";

export function registerListDms(parent: Command): void {
  parent
    .command("list")
    .description("List direct message conversations")
    .option("-l, --limit <n>", "Number of DM conversations (1-100)", "50")
    .action(
      withErrorHandler(async (opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const limit = parseDmLimit(opts.limit);
        const auth = resolveAuth(globals);
        const workspace_id = globals.workspace ?? auth.workspace_id;
        const result = await createApiClient(auth).listDms({
          workspace_id,
          limit,
        });

        output(globals, {
          data: result.dms.map(formatDmRow),
          columns: [
            "channel_id",
            "channel_type",
            "participants",
            "last_message_at",
            "unread_count",
          ],
          title: "DM conversations",
          breadcrumbs: [
            {
              action: "read_dm",
              cmd: 'ano dm read "<name>" --limit 25',
              description: "Read a direct message conversation",
            },
            {
              action: "send_dm",
              cmd: 'ano dm send "..." --to "<name>"',
              description: "Send a direct message",
            },
          ],
        });
      }),
    );
}

export function formatDmRow(dm: DmConversation): {
  channel_id: string;
  channel_type: "dm" | "group_dm";
  participants: string;
  last_message_at: string | null;
  unread_count: number;
} {
  return {
    channel_id: dm.channel_id,
    channel_type: dm.channel_type,
    participants: dm.participant_names.join(", ") || "Notes",
    last_message_at: dm.last_message_at,
    unread_count: Number(dm.unread_count ?? 0),
  };
}
