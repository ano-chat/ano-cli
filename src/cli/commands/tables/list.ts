import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

export function registerListTables(parent: Command): void {
  parent
    .command("list")
    .description("List all tables in the workspace")
    .action(
      withErrorHandler(async (_opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const result = await client.listTables({
          workspace_id: globals.workspace,
        });

        output(globals, {
          data: result,
          columns: ["id", "name", "prefix", "item_count"],
          title: "Tables",
          breadcrumbs: [
            {
              action: "get_table",
              cmd: "ano tables get <id>",
              description: "Get table details and field schema",
            },
            {
              action: "query_table_items",
              cmd: "ano tables query <table-id>",
              description: "Query items in a table",
            },
          ],
        });
      }),
    );
}
