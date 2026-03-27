import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

export function registerReadMessages(parent: Command): void {
  parent
    .command("read")
    .description("Read messages from a channel")
    .requiredOption("-c, --channel <id>", "Channel ID")
    .option("-l, --limit <n>", "Number of messages (1-100)", "25")
    .action(
      withErrorHandler(async (opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const result = await client.readMessages({
          channel_id: opts.channel,
          limit: parseInt(opts.limit, 10),
        });

        output(globals, {
          data: result.messages,
          columns: ["sender", "content", "timestamp"],
          title: `Messages in ${opts.channel}`,
          breadcrumbs: [
            {
              action: "send_message",
              cmd: `ano messages send --channel ${opts.channel} "..."`,
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
