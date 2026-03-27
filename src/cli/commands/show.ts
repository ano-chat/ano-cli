import { Command } from "commander";
import type { GlobalOptions } from "../types.js";
import { withErrorHandler } from "../middleware/error-handler.js";
import { resolveAuth } from "../../core/auth.js";
import { createApiClient } from "../../core/api-client.js";
import { output } from "../../core/output.js";
import { parseAnoUrl } from "../../core/url-parser.js";

export function registerShow(parent: Command): void {
  parent
    .command("show")
    .description("Display content from an Ano URL")
    .argument("<url>", "Ano URL to display")
    .action(
      withErrorHandler(async (url, _opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const parsed = parseAnoUrl(url);

        if (!parsed) {
          console.error("Error: Not a recognized Ano URL");
          process.exit(1);
        }

        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        if (
          (parsed.type === "channel" || parsed.type === "message") &&
          parsed.channel
        ) {
          const result = await client.readMessages({
            channel_id: parsed.channel,
          });
          const messages = result.messages.map((m) => ({
            ...m,
            sender: typeof m.sender === "object" ? m.sender.name : m.sender,
          }));
          output(globals, {
            data: messages,
            columns: ["sender", "content", "timestamp"],
            title: `Messages`,
            breadcrumbs: [
              {
                action: "send_message",
                cmd: `ano messages send --channel ${parsed.channel} "..."`,
                description: "Send a message",
              },
            ],
          });
        } else {
          const ctx = await client.context();
          output(globals, {
            data: ctx,
            title: ctx.workspace.name,
            breadcrumbs: [
              {
                action: "list_channels",
                cmd: "ano channels list",
                description: "List channels",
              },
            ],
          });
        }
      }),
    );
}
