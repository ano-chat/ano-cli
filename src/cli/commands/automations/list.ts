import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

export function registerAutomationList(parent: Command): void {
  parent
    .command("list")
    .description("List automations in the workspace")
    .action(
      withErrorHandler(async (_opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const result = await client.automationList({
          workspace_id: globals.workspace,
        });
        output(globals, {
          data: result.automations,
          columns: [
            "id",
            "name",
            "trigger_type",
            "status",
            "enabled",
            "run_count",
          ],
          title: "Automations",
          breadcrumbs: [
            {
              action: "automation_runs",
              cmd: "ano automation runs <automation-id>",
              description: "Show run history for an automation",
            },
          ],
        });
      }),
    );
}
