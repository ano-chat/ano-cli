import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import { resolveAutomation } from "./resolve-automation.js";

export function registerAutomationPause(parent: Command): void {
  parent
    .command("pause <slug-or-id>")
    .description("Pause an automation (stop firing on its trigger)")
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
        const result = await client.automationPause({
          automation_id: automationId,
          enabled: false,
        });
        output(globals, { data: result, title: "Paused" });
      }),
    );

  parent
    .command("resume <slug-or-id>")
    .description("Resume a paused automation")
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
        const result = await client.automationPause({
          automation_id: automationId,
          enabled: true,
        });
        output(globals, { data: result, title: "Resumed" });
      }),
    );
}
