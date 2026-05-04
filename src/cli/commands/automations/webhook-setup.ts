import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import { slugFromId } from "../../../util/slug.js";
import { resolveAutomation } from "./resolve-automation.js";

export function registerAutomationWebhookSetup(parent: Command): void {
  parent
    .command("webhook-setup <slug-or-id>")
    .description(
      "Mint (or rotate) the inbound webhook URL + HMAC secret for a webhook-triggered automation. Secret is shown once; previous secret keeps working for 24h after rotation.",
    )
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
        const result = await client.automationWebhookSetup({
          automation_id: automationId,
        });
        output(globals, {
          data: result,
          title: "Webhook URL + Secret",
          breadcrumbs: [
            {
              action: "automation_runs",
              cmd: `ano automation runs ${slugFromId(automationId)}`,
              description:
                "Watch run history once the third party starts hitting the URL",
            },
          ],
        });
      }),
    );
}
