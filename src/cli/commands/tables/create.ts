import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

export function registerCreateTable(parent: Command): void {
  parent
    .command("create")
    .description("Create a new table")
    .argument("<name>", "Table name")
    .option("-d, --description <text>", "Table description")
    .option(
      "--template <type>",
      "Template: default (status/priority/assignee) or blank",
      "default",
    )
    .option("--icon <emoji>", "Emoji icon")
    .option("--color <hex>", "Hex color")
    .option("--prefix <prefix>", "2-5 uppercase letter prefix for item IDs")
    .action(
      withErrorHandler(async (name, opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const result = await client.createTable({
          workspace_id: globals.workspace,
          name,
          description: opts.description,
          template_type: opts.template,
          icon: opts.icon,
          color: opts.color,
          prefix: opts.prefix,
        });

        output(globals, {
          data: result,
          title: `Table created: ${result.name}`,
          breadcrumbs: [
            {
              action: "get_table",
              cmd: `ano tables get ${result.id}`,
              description: "View table schema",
            },
            {
              action: "create_table_item",
              cmd: `ano tables create-item --table ${result.id} --fields '{}'`,
              description: "Create an item in this table",
            },
          ],
        });
      }),
    );
}
