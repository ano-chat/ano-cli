import { Command } from "commander";

import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

interface CoworkerCreateOpts {
  roleTitle: string;
  expertise?: string;
  personality?: string;
  boundaries?: string;
  customInstructions?: string;
  modelProvider?: string;
  modelId?: string;
  external?: boolean;
  webhookUrl?: string;
  channels?: string;
  capabilities?: string;
}

/**
 * `ano coworker create <display-name> --role-title "Ops engineer" [...]`
 *   — wraps the manifest `coworker_create` server op. For external
 *   coworkers (mode='external'), prints the api_key + webhook_secret
 *   ONCE on the response — not recoverable later, save them now.
 */
export function registerCoworkerCreate(parent: Command): void {
  parent
    .command("create <display-name>")
    .description(
      "Create an AI coworker (managed or external) in the workspace. Caller must be a workspace admin.",
    )
    .requiredOption(
      "--role-title <title>",
      "Short label for the coworker's role (≤80 chars)",
    )
    .option("--expertise <text>", "What the coworker is good at (≤2000 chars)")
    .option("--personality <text>", "Tone / persona (≤2000 chars)")
    .option(
      "--boundaries <text>",
      "What the coworker should NOT do (≤2000 chars)",
    )
    .option(
      "--custom-instructions <text>",
      "Free-form instructions that prepend to every prompt (≤4000 chars)",
    )
    .option(
      "--model-provider <name>",
      "anthropic-managed | google | (default: anthropic-managed)",
    )
    .option("--model-id <id>", "Model identifier")
    .option(
      "--external",
      "Create as external coworker (requires --webhook-url; returns api_key + webhook_secret once)",
      false,
    )
    .option(
      "--webhook-url <url>",
      "External-coworker webhook endpoint (required when --external)",
    )
    .option(
      "--channels <ids>",
      "Comma-separated channel IDs to add the coworker to at create time",
    )
    .option(
      "--capabilities <slugs>",
      "Comma-separated capability slugs (e.g. send_message,read_table)",
    )
    .action(
      withErrorHandler(
        async (displayName: string, opts: CoworkerCreateOpts, cmd) => {
          const globals = cmd.optsWithGlobals() as GlobalOptions;
          const auth = resolveAuth(globals);
          const client = createApiClient(auth);

          const channel_ids = opts.channels
            ? opts.channels
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined;
          const capabilities = opts.capabilities
            ? opts.capabilities
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined;

          const result = await client.coworkerCreate({
            display_name: displayName,
            workspace_id: globals.workspace,
            role_title: opts.roleTitle,
            expertise: opts.expertise,
            personality: opts.personality,
            boundaries: opts.boundaries,
            custom_instructions: opts.customInstructions,
            model_provider: opts.modelProvider,
            model_id: opts.modelId,
            mode: opts.external ? "external" : undefined,
            webhook_url: opts.webhookUrl,
            channel_ids,
            capabilities,
          });

          output(globals, {
            data: result,
            title: opts.external
              ? `External coworker ${result.display_name} created — save api_key + webhook_secret NOW (not recoverable)`
              : `Coworker ${result.display_name} created`,
            breadcrumbs: [
              {
                action: "list_users",
                cmd: "ano users list --agent",
                description:
                  "Confirm the new coworker appears in workspace users",
              },
              {
                action: "send_dm",
                cmd: `ano dm send "Welcome aboard" --user-id ${result.id}`,
                description: "Greet the new coworker",
              },
            ],
          });
        },
      ),
    );
}
