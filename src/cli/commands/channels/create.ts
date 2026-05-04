import { Command } from "commander";

import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

interface ChannelCreateOpts {
  topic?: string;
  description?: string;
  private?: boolean;
  type?: "channel" | "space";
  members?: string;
}

/**
 * `ano channels create <name> [--private] [--topic ...] [--members u1,u2]`
 * — wraps the manifest-driven `channel_create` server op. Closes the
 * highest-frequency CLI/MCP parity gap with the desktop.
 */
export function registerChannelCreate(parent: Command): void {
  parent
    .command("create <name>")
    .description("Create a public or private channel in the workspace")
    .option("--topic <text>", "Channel topic (≤250 chars)")
    .option("--description <text>", "Channel description (≤1000 chars)")
    .option("--private", "Create as private (default: public)", false)
    .option(
      "--type <type>",
      "channel | space (default: channel)",
      "channel" as "channel" | "space",
    )
    .option(
      "--members <ids>",
      "Comma-separated user IDs to add as members (creator is added automatically)",
    )
    .action(
      withErrorHandler(async (name: string, opts: ChannelCreateOpts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        const member_ids = opts.members
          ? opts.members
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;

        const result = await client.channelCreate({
          name,
          workspace_id: globals.workspace,
          topic: opts.topic,
          description: opts.description,
          is_private: opts.private,
          type: opts.type,
          member_ids,
        });

        output(globals, {
          data: result,
          title: `Channel #${result.name} created (${result.member_count} members)`,
          breadcrumbs: [
            {
              action: "send_message",
              cmd: `ano messages send "..." --channel ${result.id}`,
              description: "Send the first message to the new channel",
            },
            {
              action: "list_channels",
              cmd: "ano channels list --agent",
              description: "Confirm the channel appears in the workspace list",
            },
          ],
        });
      }),
    );
}
