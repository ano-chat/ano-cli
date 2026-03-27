import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

export function registerSearchMessages(parent: Command): void {
  parent
    .command("search")
    .description("Search messages across the workspace")
    .argument("<query>", "Search query (1-500 chars)")
    .option("-l, --limit <n>", "Max results (1-50)", "20")
    .action(
      withErrorHandler(async (query, opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const result = await client.searchMessages({
          query,
          workspace_id: globals.workspace,
          limit: parseInt(opts.limit, 10),
        });

        output(globals, {
          data: result.messages,
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
