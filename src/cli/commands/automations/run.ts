import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import { slugFromId } from "../../../util/slug.js";
import { resolveAutomation } from "./resolve-automation.js";

interface RunOpts {
  dryRun?: boolean;
}

export function registerAutomationRun(parent: Command): void {
  parent
    .command("run <slug-or-id>")
    .description(
      "Test an automation. Defaults to dry-run (shows the actions that WOULD execute, without firing them). Pass --no-dry-run to fire for real.",
    )
    .option(
      "--dry-run",
      "Show actions the engine WOULD execute without firing them (default: true).",
      true,
    )
    .option(
      "--no-dry-run",
      "Actually fire the actions — same as the desktop 'Run now' button.",
    )
    .action(
      withErrorHandler(async (input: string, opts: RunOpts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const automationId = await resolveAutomation({
          client,
          workspace: globals.workspace,
          input,
        });
        const result = await client.automationRun({
          automation_id: automationId,
          dry_run: opts.dryRun !== false,
        });
        output(globals, {
          data: result,
          title: result.dry_run ? "Dry Run — Would Execute" : "Run",
          breadcrumbs: [
            {
              action: "automation_runs",
              cmd: `ano automation runs ${slugFromId(automationId)}`,
              description: "Run history",
            },
          ],
        });
      }),
    );
}
