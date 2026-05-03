import { Command } from "commander";

import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

/**
 * `ano automation webhook-test <id>` — send a synthetic HMAC-signed
 * test payload to the saved webhook URL and report status + latency.
 *
 * Verifies the user's HMAC validation logic accepts an Ano-signed body
 * and the endpoint returns 2xx, BEFORE relying on the automation in
 * production. Pairs with `webhook-setup` (which mints the URL+secret)
 * and `runs` (which shows live deliveries).
 */
export function registerAutomationWebhookTest(parent: Command): void {
  parent
    .command("webhook-test <automation-id>")
    .description(
      "POST a synthetic HMAC-signed test payload to a webhook automation's URL. Verifies the endpoint accepts the signature and returns 2xx.",
    )
    .action(
      withErrorHandler(async (automationId: string, _opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        const result = await client.webhookTest({
          automation_id: automationId,
        });

        output(globals, {
          data: result,
          title: result.ok
            ? `Webhook reachable — ${result.status} in ${result.latency_ms}ms`
            : result.error
              ? `Webhook unreachable: ${result.error}`
              : `Webhook returned ${result.status} in ${result.latency_ms}ms`,
          breadcrumbs: result.ok
            ? [
                {
                  action: "automation_runs",
                  cmd: `ano automation runs ${automationId}`,
                  description: "Watch live deliveries once the trigger fires",
                },
              ]
            : [
                {
                  action: "automation_webhook_setup",
                  cmd: `ano automation webhook-setup ${automationId}`,
                  description:
                    "Re-mint the webhook URL + signing secret if the endpoint can't validate",
                },
              ],
        });
      }),
    );
}
