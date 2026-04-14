import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

export function registerCreateItem(parent: Command): void {
  parent
    .command("create-item")
    .description("Create a new item in a table")
    .requiredOption("-t, --table <id>", "Table ID")
    .requiredOption(
      "-f, --fields <json>",
      'Field values as JSON, e.g. \'{"field_id": "value"}\'',
    )
    .action(
      withErrorHandler(async (opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const fields = JSON.parse(opts.fields);
        const result = await client.createTableItem({
          table_id: opts.table,
          fields,
        });

        output(globals, {
          data: result,
          title: "Item created",
          breadcrumbs: [
            {
              action: "query_table_items",
              cmd: `ano tables query ${opts.table}`,
              description: "View items in this table",
            },
            {
              action: "update_table_item",
              cmd: `ano tables update-item ${result.item_id} --fields '{}'`,
              description: "Update this item",
            },
          ],
        });
      }),
    );
}
