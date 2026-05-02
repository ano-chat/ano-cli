import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

export function registerAutomationCompile(parent: Command): void {
  parent
    .command("compile <prompt>")
    .description(
      "Compile a natural-language prompt into an automation plan (no save)",
    )
    .action(
      withErrorHandler(async (prompt: string, _opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const result = await client.automationCompile({
          prompt,
          workspace_id: globals.workspace,
        });
        output(globals, {
          data: result,
          title: "Compiled Automation",
          breadcrumbs: [
            {
              action: "automation_create",
              cmd: 'ano automation create "<prompt>"',
              description: "Compile + save in one step",
            },
          ],
        });
      }),
    );
}
