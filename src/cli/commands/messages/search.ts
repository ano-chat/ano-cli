import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import { searchMessagesViaZero } from "../../../zero/reads.js";

export function registerSearchMessages(parent: Command): void {
  parent
    .command("search")
    .description("Search messages across the workspace")
    .argument("<query>", "Search query (1-500 chars)")
    .option("-l, --limit <n>", "Max results (1-50)", "20")
    .action(
      withErrorHandler(async (query, opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const limit = parseInt(opts.limit, 10);
        const auth = resolveAuth(globals);
        const workspace_id = globals.workspace ?? auth.workspace_id;
        const zeroResult = await searchMessagesViaZero({
          query,
          workspace_id,
          limit,
        });
        const result =
          zeroResult ??
          (await (async () => {
            const client = createApiClient(auth);
            return await client.searchMessages({
              query,
              workspace_id,
              limit,
            });
          })());

        const messages = result.messages.map((m) => ({
          ...m,
          sender: typeof m.sender === "object" ? m.sender.name : m.sender,
        }));

        output(globals, {
          data: messages,
          columns: ["channel", "sender", "content", "timestamp"],
          title: `Search: "${query}"`,
          breadcrumbs: [
            {
              action: "read_messages",
              cmd: "ano messages read --channel <id>",
              description: "Read full channel for context",
            },
          ],
        });
      }),
    );
}
