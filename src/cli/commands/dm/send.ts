import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import {
  createApiClient,
  type SendDmResult,
  type SendGroupDmResult,
} from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

/**
 * Normalise repeated `--to` values + comma-separated forms into a clean
 * deduped name list. `--to "Alice" --to "Bob"`, `--to "Alice,Bob"`,
 * and `--to Alice Bob` all become `["Alice", "Bob"]`.
 */
function normalizeRecipients(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    for (const piece of entry.split(",")) {
      const trimmed = piece.trim();
      if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    }
  }
  return out;
}

export function registerSendDm(parent: Command): void {
  parent
    .command("send")
    .description("Send a direct message (1:1 or group)")
    .argument("<content>", "Message content")
    .option(
      "--to <names...>",
      "Recipient display name(s). Repeat the flag or pass comma-separated; ≥2 = group DM",
    )
    .option("--email <email>", "Recipient email (1:1 only)")
    .option(
      "--user-id <ids...>",
      "Recipient user ID(s). Repeat or comma-separated; ≥2 = group DM",
    )
    .action(
      withErrorHandler(async (content, opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        const names = normalizeRecipients(opts.to);
        const ids = normalizeRecipients(opts.userId);
        const totalRecipients =
          names.length + ids.length + (opts.email ? 1 : 0);

        if (totalRecipients === 0) {
          throw new Error(
            "At least one of --to, --user-id, or --email is required.",
          );
        }

        const isGroup = totalRecipients > 1;
        if (isGroup && opts.email) {
          throw new Error(
            "--email is only supported for 1:1 DMs. For group DMs, use --to or --user-id.",
          );
        }

        const result = isGroup
          ? await client.sendDm({
              recipient_names: names,
              user_ids: ids,
              content,
              workspace_id: globals.workspace,
            })
          : await client.sendDm({
              recipient_name: names[0],
              recipient_email: opts.email,
              user_id: ids[0],
              content,
              workspace_id: globals.workspace,
            });

        const title = isGroup
          ? `DM sent to ${(result as SendGroupDmResult).recipients.join(", ")}`
          : `DM sent to ${(result as SendDmResult).recipient}`;

        output(globals, {
          data: result,
          title,
          breadcrumbs: [
            {
              action: "list_users",
              cmd: "ano users list",
              description: "List workspace members",
            },
          ],
        });
      }),
    );
}
