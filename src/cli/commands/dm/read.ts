import { Command } from "commander";
import type { DmConversation, Message } from "../../../core/api-client.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import { resolveAuth } from "../../../core/auth.js";
import { readMessagesViaZero } from "../../../zero/reads.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import type { GlobalOptions } from "../../types.js";
import { parseDmLimit, parseDmRecipients, toDmRequest } from "./recipients.js";

export function registerReadDm(parent: Command): void {
  parent
    .command("read")
    .description("Read messages from a direct message conversation")
    .argument("[recipient]", "Recipient display name")
    .option(
      "--to <names...>",
      "Recipient display name(s). Repeat the flag or pass comma-separated; ≥2 = group DM",
    )
    .option("--email <email>", "Recipient email (1:1 only)")
    .option(
      "--user-id <ids...>",
      "Recipient user ID(s). Repeat or comma-separated; ≥2 = group DM",
    )
    .option("-l, --limit <n>", "Number of messages (1-100)", "25")
    .action(
      withErrorHandler(async (recipient, opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const limit = parseDmLimit(opts.limit);
        const recipients = parseDmRecipients({
          target: recipient,
          to: opts.to,
          email: opts.email,
          userId: opts.userId,
        });
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const workspace_id = globals.workspace ?? auth.workspace_id;

        const { channel } = await client.resolveDm({
          ...toDmRequest(recipients),
          workspace_id,
        });

        const zeroMessages = await readMessagesViaZero({
          channel_id: channel.channel_id,
          limit,
          timeout_ms: 100,
        });
        const messages =
          zeroMessages?.messages ??
          (
            await client.readMessages({
              channel_id: channel.channel_id,
              limit,
            })
          ).messages;

        output(globals, {
          data: messages.map(formatMessageRow),
          columns: ["sender", "content", "timestamp"],
          title: `Messages with ${formatParticipants(channel)}`,
          breadcrumbs: [
            {
              action: "send_dm",
              cmd: buildSendBreadcrumb(recipients),
              description: "Reply to this direct message",
            },
            {
              action: "list_dms",
              cmd: "ano dm list --agent",
              description: "List direct message conversations",
            },
          ],
        });
      }),
    );
}

function formatMessageRow(message: Message): {
  sender: string;
  content: string;
  timestamp: number;
} {
  return {
    sender:
      typeof message.sender === "object" ? message.sender.name : message.sender,
    content: message.content,
    timestamp: message.timestamp,
  };
}

function formatParticipants(channel: DmConversation): string {
  return channel.participant_names.join(", ") || "Notes";
}

function buildSendBreadcrumb(
  recipients: ReturnType<typeof parseDmRecipients>,
): string {
  if (recipients.email) return `ano dm send "..." --email ${recipients.email}`;
  if (recipients.isGroup) {
    return [
      'ano dm send "..."',
      ...recipients.names.map((name) => `--to "${name}"`),
      ...recipients.ids.map((id) => `--user-id ${id}`),
    ].join(" ");
  }
  if (recipients.ids[0])
    return `ano dm send "..." --user-id ${recipients.ids[0]}`;
  return `ano dm send "..." --to "${recipients.names[0]}"`;
}
