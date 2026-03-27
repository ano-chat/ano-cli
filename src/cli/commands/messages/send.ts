import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

export function registerSendMessage(parent: Command): void {
  parent
    .command("send")
    .description("Send a message to a channel")
    .argument("<content>", "Message content (supports markdown)")
    .requiredOption("-c, --channel <id>", "Channel ID")
    .option("-t, --thread <id>", "Reply in thread")
    .option("--mention <ids...>", "User IDs to @mention")
    .action(
      withErrorHandler(async (content, opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const result = await client.sendMessage({
          channel_id: opts.channel,
          content,
          thread_id: opts.thread,
          mentions: opts.mention,
        });

        output(globals, {
          data: result,
          title: "Message sent",
          breadcrumbs: [
            {
              action: "read_messages",
              cmd: `ano messages read --channel ${opts.channel}`,
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
