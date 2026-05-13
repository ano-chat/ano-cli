import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import { resolveFiles, uploadAttachments } from "../../file-attachments.js";

export function registerSendMessage(parent: Command): void {
  parent
    .command("send")
    .description("Send a message to a channel")
    .argument("<content>", "Message content (supports markdown)")
    .option("-c, --channel <id>", "Channel ID")
    .option(
      "-n, --channel-name <name>",
      "Channel name (resolved server-side; pick this over --channel + a list lookup)",
    )
    .option("-t, --thread <id>", "Reply in thread")
    .option("--mention <ids...>", "User IDs to @mention")
    .option(
      "--file <paths...>",
      'Local file path(s) to attach. Repeat the flag or pass comma-separated. Empty content is OK when --file is used (e.g. send a screenshot only with content "").',
    )
    .action(
      withErrorHandler(async (content, opts, cmd) => {
        if (!opts.channel && !opts.channelName) {
          throw new Error(
            "Either --channel <id> or --channel-name <name> is required.",
          );
        }
        const filePaths = resolveFiles(opts.file);
        if (content.trim().length === 0 && filePaths.length === 0) {
          throw new Error(
            "Empty content requires at least one --file attachment.",
          );
        }
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const attachments =
          filePaths.length > 0
            ? await uploadAttachments(client, filePaths)
            : undefined;
        const result = await client.sendMessage({
          channel_id: opts.channel,
          channel_name: opts.channelName,
          content,
          thread_id: opts.thread,
          mentions: opts.mention,
          attachments,
        });

        const resolvedChannel = opts.channel ?? result.channel_id;
        output(globals, {
          data: result,
          title: "Message sent",
          breadcrumbs: [
            {
              action: "read_messages",
              cmd: `ano messages read --channel ${resolvedChannel}`,
              description: "Read channel messages",
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
