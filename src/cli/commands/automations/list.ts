import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import { slugFromId } from "../../../util/slug.js";

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
        // Enrich each automation row with a stable display slug so the
        // human-readable styled output never has to surface a UUID.
        // The raw `id` stays on the row for JSON/agent output and so
        // scripts that already parse the field keep working.
        const rows = result.automations.map((a) => ({
          ...a,
          slug: slugFromId(a.id),
        }));
        output(globals, {
          data: rows,
          columns: [
            "slug",
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
              cmd: "ano automation runs <slug-or-id>",
              description: "Show run history for an automation (slug or UUID).",
            },
          ],
        });
      }),
    );
}
