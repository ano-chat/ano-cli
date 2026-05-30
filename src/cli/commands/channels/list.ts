import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import { listChannelsViaZero } from "../../../zero/reads.js";

export function registerListChannels(parent: Command): void {
  parent
    .command("list")
    .description("List channels in the workspace")
    .option(
      "--unread",
      "Only channels with unread messages for the caller. Each row carries unread_count, last_message_at, last_read_at; sorted freshest first. Skips the Zero fast-path (Zero's local replica doesn't carry per-user read state).",
    )
    .action(
      withErrorHandler(async (opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const unread = opts.unread === true;

        // Zero-fast-path: if the daemon has a Zero replica, serve from
        // local SQLite (microsecond reads). Falls through to REST on
        // miss, timeout, or any query error.
        //
        // The fast-path is bypassed for `--unread` — Zero's local replica
        // is channel metadata only; per-user read state (unread_count /
        // last_read_at) lives in `user_channel_stats` on the regional API
        // and isn't replicated to the daemon's SQLite.
        const zeroResult = unread
          ? null
          : await listChannelsViaZero({
              workspace_id: globals.workspace,
            });
        const result =
          zeroResult ??
          (await (async () => {
            const auth = resolveAuth(globals);
            const client = createApiClient(auth);
            return await client.listChannels({
              workspace_id: globals.workspace,
              ...(unread ? { unread: true } : {}),
            });
          })());

        const columns = unread
          ? [
              "id",
              "name",
              "unread_count",
              "last_message_at",
              "last_read_at",
              "topic",
            ]
          : ["id", "name", "type", "workspace_id", "topic"];

        output(globals, {
          data: result.channels,
          columns,
          title: unread ? "Unread channels" : "Channels",
          breadcrumbs: unread
            ? [
                {
                  action: "read_messages",
                  cmd: "ano messages read --channel <id> --limit 100",
                  description: "Read the unread channel's recent history",
                },
                {
                  action: "send_message",
                  cmd: 'ano messages send --channel <id> "…"',
                  description: "Reply in an unread channel",
                },
              ]
            : [
                {
                  action: "read_messages",
                  cmd: "ano messages read --channel <id>",
                  description: "Read messages from a channel",
                },
                {
                  action: "send_message",
                  cmd: 'ano messages send --channel <id> "Hello"',
                  description: "Send a message to a channel",
                },
                {
                  action: "list_users",
                  cmd: "ano users list",
                  description: "List workspace members",
                },
              ],
        });
      }),
    );
}
