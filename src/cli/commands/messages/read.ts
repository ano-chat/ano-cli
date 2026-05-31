import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import { readMessagesViaZero } from "../../../zero/reads.js";
import { parseSingleChannelRef, resolveChannelId } from "./channel-target.js";

export function registerReadMessages(parent: Command): void {
  parent
    .command("read")
    .description("Read messages from a channel")
    .argument("[target]", "Channel ID, #channel, or channel name")
    .option("-c, --channel <id-or-name>", "Channel ID or name")
    .option("-n, --channel-name <name>", "Channel name")
    .option("-l, --limit <n>", "Number of messages (1-100)", "25")
    .action(
      withErrorHandler(async (target, opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const limit = parseInt(opts.limit, 10);
        const ref = parseSingleChannelRef({ target, ...opts });
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const channelId = await resolveChannelId({
          ref,
          workspaceId: globals.workspace ?? auth.workspace_id,
          client,
        });
        const zeroResult = await readMessagesViaZero({
          channel_id: channelId,
          limit,
        });
        const result =
          zeroResult ??
          (await client.readMessages({
            channel_id: channelId,
            limit,
          }));

        const messages = result.messages.map((m) => ({
          ...m,
          sender: typeof m.sender === "object" ? m.sender.name : m.sender,
        }));

        output(globals, {
          data: messages,
          columns: ["sender", "content", "timestamp"],
          title: `Messages in ${ref.kind === "name" ? `#${ref.value}` : channelId}`,
          breadcrumbs: [
            {
              action: "send_message",
              cmd:
                ref.kind === "name"
                  ? `ano messages send "..." --channel-name ${ref.value}`
                  : `ano messages send --channel ${channelId} "..."`,
              description: "Reply to this channel",
            },
            {
              action: "search_messages",
              cmd: 'ano messages search "query"',
              description: "Search messages",
            },
          ],
        });
      }),
    );
}
