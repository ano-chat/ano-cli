import { Command } from "commander";

import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

interface InviteCreateOpts {
  expiresHours?: string;
}

/**
 * `ano invite <email> [--expires-hours N]`
 *   — the bare-name `ano invite ...` is the verb, not a group, because
 *   "invite a teammate" is the natural phrasing. Subcommands like
 *   `ano invite list` could be added later under the same group.
 *
 * Wraps the manifest `invite_user` server op. Caller must be a
 * workspace admin/owner. Server-side emailing is NOT automated by this
 * op — we return the invite URL; the caller shares it however they
 * want (paste in chat, email, Slack, etc.).
 */
export function registerInviteCreate(parent: Command): void {
  parent
    .argument("[email]", "Recipient email (optional — omit for an open token)")
    .option(
      "--expires-hours <n>",
      "Token TTL in hours (default 168 = 7d, max 720 = 30d)",
    )
    .action(
      withErrorHandler(
        async (email: string | undefined, opts: InviteCreateOpts, cmd) => {
          const globals = cmd.optsWithGlobals() as GlobalOptions;
          const auth = resolveAuth(globals);
          const client = createApiClient(auth);

          const expiresHours = opts.expiresHours
            ? Number.parseInt(opts.expiresHours, 10)
            : undefined;
          if (
            opts.expiresHours !== undefined &&
            (Number.isNaN(expiresHours) ||
              expiresHours === undefined ||
              expiresHours < 1 ||
              expiresHours > 720)
          ) {
            throw new Error(
              "--expires-hours must be an integer between 1 and 720",
            );
          }

          const result = await client.inviteUser({
            workspace_id: globals.workspace,
            invited_email: email,
            expires_in_hours: expiresHours,
          });

          output(globals, {
            data: result,
            title: email
              ? `Invite created for ${email}`
              : "Open invite created (no email recorded)",
            breadcrumbs: [
              {
                action: "share_url",
                cmd: `echo "${result.invite_url}"`,
                description:
                  "Send the invite URL to the recipient — Ano does not auto-email from this command",
              },
              {
                action: "list_workspaces",
                cmd: "ano workspaces list --agent",
                description: "Confirm you're an admin in the target workspace",
              },
            ],
          });
        },
      ),
    );
}
