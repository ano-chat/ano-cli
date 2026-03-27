import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

export function registerSendDm(parent: Command): void {
  parent
    .command("send")
    .description("Send a direct message")
    .argument("<content>", "Message content")
    .option("--to <name>", "Recipient display name")
    .option("--email <email>", "Recipient email")
    .option("--user-id <id>", "Recipient user ID")
    .action(
      withErrorHandler(async (content, opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const result = await client.sendDm({
          recipient_name: opts.to,
          recipient_email: opts.email,
          user_id: opts.userId,
          content,
          workspace_id: globals.workspace,
        });

        output(globals, {
          data: result,
          title: `DM sent to ${result.recipient}`,
          breadcrumbs: [
            {
              action: "list_users",
              cmd: "ano users list",
              description: "List workspace members",
            },
          ],
        });
      }),
    );
}
