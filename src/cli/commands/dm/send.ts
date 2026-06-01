import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import {
  createApiClient,
  type SendDmResult,
  type SendGroupDmResult,
} from "../../../core/api-client.js";
import { AnoCliError } from "../../../core/errors.js";
import { output } from "../../../core/output.js";
import { ExitCode } from "../../types.js";
import { parseDmRecipients, toDmRequest } from "./recipients.js";
import {
  collectFileArg,
  resolveFiles,
  uploadAttachments,
} from "../../file-attachments.js";

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
    .option(
      "--file <path>",
      'Local file to attach. Repeat the flag (--file a --file b) or pass comma-separated for multiple. Order-independent — does NOT swallow the content argument. Empty content is OK when --file is used (e.g. send a screenshot only with content "").',
      collectFileArg,
    )
    .action(
      withErrorHandler(async (content, opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        const recipients = parseDmRecipients({
          to: opts.to,
          email: opts.email,
          userId: opts.userId,
        });

        const filePaths = resolveFiles(opts.file);
        if (content.trim().length === 0 && filePaths.length === 0) {
          throw new AnoCliError(
            "Empty content requires at least one --file attachment.",
            ExitCode.USAGE,
          );
        }
        const attachments =
          filePaths.length > 0
            ? await uploadAttachments(client, filePaths)
            : undefined;

        const result = await client.sendDm({
          ...toDmRequest(recipients),
          content,
          workspace_id: globals.workspace,
          attachments,
        });

        const title = recipients.isGroup
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
