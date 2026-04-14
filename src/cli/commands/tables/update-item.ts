import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

export function registerUpdateItem(parent: Command): void {
  parent
    .command("update-item")
    .description("Update an existing table item")
    .argument("<item-id>", "Item ID to update")
    .option(
      "-f, --fields <json>",
      'Partial field update as JSON, e.g. \'{"field_id": "new value"}\'',
    )
    .option("--archive", "Archive the item")
    .option("--unarchive", "Unarchive the item")
    .action(
      withErrorHandler(async (itemId, opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        const fields = opts.fields ? JSON.parse(opts.fields) : undefined;
        let isArchived: boolean | undefined;
        if (opts.archive) isArchived = true;
        if (opts.unarchive) isArchived = false;

        const result = await client.updateTableItem({
          item_id: itemId,
          fields,
          is_archived: isArchived,
        });

        output(globals, {
          data: result,
          title: "Item updated",
          breadcrumbs: [
            {
              action: "query_table_items",
              cmd: "ano tables query <table-id>",
              description: "View items in the table",
            },
            {
              action: "add_table_item_comment",
              cmd: `ano tables comment ${itemId} "comment"`,
              description: "Add a comment",
            },
          ],
        });
      }),
    );
}
