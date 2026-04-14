import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

export function registerCommentItem(parent: Command): void {
  parent
    .command("comment")
    .description("Add a comment to a table item")
    .argument("<item-id>", "Item ID to comment on")
    .argument("<body>", "Comment text")
    .action(
      withErrorHandler(async (itemId, body, _opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const result = await client.addTableItemComment({
          item_id: itemId,
          body,
        });

        output(globals, {
          data: result,
          title: "Comment added",
          breadcrumbs: [
            {
              action: "query_table_items",
              cmd: "ano tables query <table-id>",
              description: "View items in the table",
            },
          ],
        });
      }),
    );
}
