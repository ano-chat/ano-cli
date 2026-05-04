import { Command } from "commander";

import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

interface PrefsSetOpts {
  globalLevel?: "everything" | "mentions_dms" | "nothing";
  email?: boolean;
  emailDelayMinutes?: string;
  desktop?: boolean;
  mobile?: boolean;
}

/**
 * `ano notifications prefs set [...]` — wraps manifest
 * `notification_preferences_set`. Partial update via COALESCE; only
 * the flags you pass are changed.
 *
 *   ano notifications prefs set --global-level mentions_dms
 *   ano notifications prefs set --no-email
 *   ano notifications prefs set --email --email-delay-minutes 5
 */
export function registerNotificationsPrefsSet(parent: Command): void {
  parent
    .command("prefs-set")
    .description(
      "Update the caller's notification preferences for the active workspace",
    )
    .option("--global-level <level>", "everything | mentions_dms | nothing")
    .option("--email", "Enable email notifications")
    .option("--no-email", "Disable email notifications")
    .option(
      "--email-delay-minutes <n>",
      "Delay before email notification fires (0-1440 min)",
    )
    .option("--desktop", "Enable desktop push")
    .option("--no-desktop", "Disable desktop push")
    .option("--mobile", "Enable mobile push")
    .option("--no-mobile", "Disable mobile push")
    .action(
      withErrorHandler(async (opts: PrefsSetOpts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        const email_delay_minutes = opts.emailDelayMinutes
          ? Number.parseInt(opts.emailDelayMinutes, 10)
          : undefined;
        if (
          opts.emailDelayMinutes !== undefined &&
          (Number.isNaN(email_delay_minutes) ||
            email_delay_minutes! < 0 ||
            email_delay_minutes! > 1440)
        ) {
          throw new Error("--email-delay-minutes must be between 0 and 1440");
        }

        const result = await client.notificationPreferencesSet({
          workspace_id: globals.workspace,
          global_level: opts.globalLevel,
          email_enabled: opts.email,
          email_delay_minutes,
          desktop_enabled: opts.desktop,
          mobile_enabled: opts.mobile,
        });

        output(globals, {
          data: result,
          title: `Notification prefs updated for workspace ${result.workspace_id}`,
        });
      }),
    );
}
