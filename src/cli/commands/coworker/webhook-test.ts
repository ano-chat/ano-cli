import { Command } from "commander";

import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

/**
 * `ano coworker webhook-test <coworker-id>` — POST a synthetic
 * HMAC-signed test payload to an external coworker's saved webhook URL
 * and report status + latency.
 *
 * Verifies the user's HMAC-validation logic accepts an Ano-signed body
 * and the endpoint returns 2xx, BEFORE relying on the integration in
 * production. The coworker must have `mode: "external"` and a saved
 * `webhook_url` + `webhook_secret`.
 */
export function registerCoworkerWebhookTest(parent: Command): void {
  parent
    .command("webhook-test <coworker-id>")
    .description(
      "POST a synthetic HMAC-signed test payload to an external coworker's webhook URL. Verifies the endpoint accepts the signature and returns 2xx.",
    )
    .action(
      withErrorHandler(async (coworkerId: string, _opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        const result = await client.webhookTest({
          coworker_id: coworkerId,
          workspace_id: globals.workspace,
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
                  action: "list_users",
                  cmd: "ano users list",
                  description:
                    "List workspace users (coworkers appear with bot avatars)",
                },
              ]
            : [
                {
                  action: "doctor",
                  cmd: "ano doctor --agent",
                  description:
                    "Diagnose connectivity if the test couldn't reach the URL",
                },
              ],
        });
      }),
    );
}
