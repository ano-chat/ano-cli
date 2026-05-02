import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

export function registerAutomationPause(parent: Command): void {
  parent
    .command("pause <automation-id>")
    .description("Pause an automation (stop firing on its trigger)")
    .action(
      withErrorHandler(async (automationId: string, _opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const result = await client.automationPause({
          automation_id: automationId,
          enabled: false,
        });
        output(globals, { data: result, title: "Paused" });
      }),
    );

  parent
    .command("resume <automation-id>")
    .description("Resume a paused automation")
    .action(
      withErrorHandler(async (automationId: string, _opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const result = await client.automationPause({
          automation_id: automationId,
          enabled: true,
        });
        output(globals, { data: result, title: "Resumed" });
      }),
    );
}
