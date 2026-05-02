import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

interface CreateOpts {
  visibility?: "personal" | "workspace";
}

export function registerAutomationCreate(parent: Command): void {
  parent
    .command("create <prompt>")
    .description(
      "Compile a natural-language prompt and save the resulting automation. Lands in 'unconfirmed' state — approve via the Automations page or DM to enable.",
    )
    .option(
      "--visibility <visibility>",
      "personal | workspace (default: personal)",
      "personal",
    )
    .action(
      withErrorHandler(async (prompt: string, opts: CreateOpts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const result = await client.automationCreateFromText({
          prompt,
          workspace_id: globals.workspace,
          visibility: opts.visibility,
        });
        output(globals, {
          data: result,
          title: "Automation Created",
          breadcrumbs: [
            {
              action: "automation_list",
              cmd: "ano automation list",
              description: "List automations in the workspace",
            },
            {
              action: "automation_runs",
              cmd: `ano automation runs ${result.id}`,
              description: "Show run history",
            },
          ],
        });
      }),
    );
}
