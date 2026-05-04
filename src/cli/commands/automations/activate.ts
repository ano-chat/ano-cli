/**
 * `ano automation activate <slug-or-id>` — flips a webhook automation
 * from stub mode to live so inbound events actually fire the
 * configured actions. Mirrors the desktop "Activate (flip stub →
 * live)" button in WebhookSetupModal and the server REST
 * `POST /api/automations/:id/activate` endpoint.
 *
 * The mint endpoint always creates new tokens in stub mode
 * (intentional — gives the desktop UI a chance to recompile against
 * the real payload shape). CLI users typically wrote the automation
 * themselves and want to activate immediately, so this command is the
 * "I'm done, flip it on" verb.
 *
 * Idempotent server-side — re-running on an already-active automation
 * is a no-op.
 */

import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import { slugFromId } from "../../../util/slug.js";
import { resolveAutomation } from "./resolve-automation.js";

export function registerAutomationActivate(parent: Command): void {
  parent
    .command("activate <slug-or-id>")
    .description(
      "Activate a webhook automation so inbound events fire the configured actions (flips token from stub mode to live).",
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
        const result = await client.automationActivate({
          automation_id: automationId,
        });
        output(globals, {
          data: result,
          title: "Activated",
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
