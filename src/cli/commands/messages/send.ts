import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import {
  collectFileArg,
  resolveFiles,
  uploadAttachments,
} from "../../file-attachments.js";
import { sendTextMessageViaZero } from "../../../zero/writes.js";

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
      "--file <path>",
      'Local file to attach. Repeat the flag (--file a --file b) or pass comma-separated for multiple. Order-independent — does NOT swallow the content argument. Empty content is OK when --file is used (e.g. send a screenshot only with content "").',
      collectFileArg,
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

        // Zero fast-path: ONLY the basic text path (channel id given,
        // no attachments, no thread, no mentions). All other paths
        // still need server-side resolution (channel_name lookup,
        // attachment upload, thread parent denormalization, mention
        // resolution from @handle → user_id) so they go through REST.
        const zeroEligible =
          !!opts.channel &&
          !opts.channelName &&
          !opts.thread &&
          !opts.mention &&
          filePaths.length === 0;
        if (zeroEligible) {
          const zeroResult = await sendTextMessageViaZero({
            channel_id: opts.channel,
            content,
          });
          if (zeroResult?.ok === false) {
            throw new Error(zeroResult.error);
          }
          if (zeroResult?.ok === true) {
            output(globals, {
              data: { id: zeroResult.id, channel_id: zeroResult.channel_id },
              title: "Message sent",
              breadcrumbs: [
                {
                  action: "read_messages",
                  cmd: `ano messages read --channel ${zeroResult.channel_id}`,
                  description: "Read channel messages",
                },
                {
                  action: "search_messages",
                  cmd: 'ano messages search "query"',
                  description: "Search messages",
                },
              ],
            });
            return;
          }
          // zeroResult === null → Zero unavailable; fall through to REST.
        }

        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const attachments =
          filePaths.length > 0
            ? await uploadAttachments(client, filePaths)
            : undefined;
        const result = await client.sendMessage({
          channel_id: opts.channel,
          channel_name: opts.channelName,
          // Scope server-side name resolution to the intended workspace.
          // Channel names are NOT unique across the workspaces a key can
          // see (prod has two #general), so without this an unscoped
          // `--channel-name` resolves the earliest-created match across
          // ALL memberships — a wrong-tenant send. The root `--workspace`
          // flag (globals.workspace) carries the scope; forward it.
          workspace_id: globals.workspace,
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
