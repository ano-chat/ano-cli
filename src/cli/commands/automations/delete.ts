import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import { resolveAutomation } from "./resolve-automation.js";

export function registerAutomationDelete(parent: Command): void {
  parent
    .command("delete <slug-or-id>")
    .description("Delete an automation (owner only — irreversible)")
    .action(
      withErrorHandler(async (input: string, _opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const automationId = await resolveAutomation({
          client,
          workspace: globals.workspace,
          input,
        });
        const result = await client.automationDelete({
          automation_id: automationId,
        });
        output(globals, { data: result, title: "Deleted" });
      }),
    );
}
