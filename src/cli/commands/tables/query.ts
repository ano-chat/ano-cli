import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

export function registerQueryItems(parent: Command): void {
  parent
    .command("query")
    .description("Query items in a table")
    .argument("<table-id>", "Table ID")
    .option("-l, --limit <n>", "Max items (default 50, max 100)", "50")
    .option("--cursor <cursor>", "Pagination cursor from previous response")
    .option("--include-archived", "Include archived items")
    .option(
      "--filter <json>",
      'Filter JSON array, e.g. \'[{"field_id":"f1","operator":"eq","value":"done"}]\'',
    )
    .option(
      "--sort <json>",
      'Sort JSON, e.g. \'{"field_id":"f1","direction":"desc"}\'',
    )
    .action(
      withErrorHandler(async (tableId, opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        const filters = opts.filter ? JSON.parse(opts.filter) : undefined;
        const sort = opts.sort ? JSON.parse(opts.sort) : undefined;

        const result = await client.queryTableItems({
          table_id: tableId,
          limit: parseInt(opts.limit, 10),
          cursor: opts.cursor,
          include_archived: opts.includeArchived ?? false,
          filters,
          sort,
        });

        output(globals, {
          data: result.items,
          title: `Items (${result.items.length}${result.has_more ? "+, has more" : ""})`,
          breadcrumbs: [
            {
              action: "update_table_item",
              cmd: `ano tables update-item <item-id> --fields '{}'`,
              description: "Update an item",
            },
            {
              action: "add_table_item_comment",
              cmd: `ano tables comment <item-id> "comment text"`,
              description: "Add a comment to an item",
            },
            ...(result.cursor
              ? [
                  {
                    action: "next_page" as const,
                    cmd: `ano tables query ${tableId} --cursor ${result.cursor}`,
                    description: "Fetch next page",
                  },
                ]
              : []),
          ],
        });
      }),
    );
}
