import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { ExitCode } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { AnoCliError } from "../../../core/errors.js";
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

        // Resolve the workspace scope for a NAME-addressed send. Channel
        // names are NOT unique across the workspaces a key can see, and the
        // server resolves an unscoped name to the earliest-created match
        // across ALL the user's memberships — returning ok:true after
        // landing the message in the WRONG tenant. Precedence:
        //   1. --workspace / ANO_WORKSPACE_ID (explicit)
        //   2. the credential's pinned workspace (`ano workspaces use`)
        // If neither resolves AND the key spans >1 workspace, the name is
        // genuinely ambiguous — refuse with guidance instead of guessing.
        // (A literal --channel <id> is globally unique, so it's exempt.)
        let effectiveWorkspaceId = globals.workspace ?? auth.workspace_id;
        if (opts.channelName && !opts.channel && !effectiveWorkspaceId) {
          const { workspaces } = await client.listWorkspaces();
          if (workspaces.length > 1) {
            const list = workspaces
              .map((w) => `  ${w.id}  ${w.name}`)
              .join("\n");
            throw new AnoCliError(
              `--channel-name "${opts.channelName}" is ambiguous: your key can ` +
                `see ${workspaces.length} workspaces and channel names are not ` +
                `unique across them. Pass --workspace <id> to disambiguate:\n${list}`,
              ExitCode.USAGE,
            );
          }
          if (workspaces.length === 1) {
            effectiveWorkspaceId = workspaces[0]!.id;
          }
        }

        const attachments =
          filePaths.length > 0
            ? await uploadAttachments(client, filePaths)
            : undefined;
        const result = await client.sendMessage({
          channel_id: opts.channel,
          channel_name: opts.channelName,
          workspace_id: effectiveWorkspaceId,
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
