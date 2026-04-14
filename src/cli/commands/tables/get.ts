import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

export function registerGetTable(parent: Command): void {
  parent
    .command("get")
    .description("Get table details including field schema")
    .argument("<table-id>", "Table ID")
    .action(
      withErrorHandler(async (tableId, _opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const result = await client.getTable({ table_id: tableId });

        output(globals, {
          data: result,
          title: result.name ?? "Table",
          breadcrumbs: [
            {
              action: "query_table_items",
              cmd: `ano tables query ${tableId}`,
              description: "Query items in this table",
            },
            {
              action: "create_table_item",
              cmd: `ano tables create-item --table ${tableId} --fields '{"field_id":"value"}'`,
              description: "Create an item in this table",
            },
          ],
        });
      }),
    );
}
