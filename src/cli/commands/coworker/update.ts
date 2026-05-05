import { Command } from "commander";

import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

interface CoworkerUpdateOpts {
  displayName?: string;
  avatarUrl?: string;
  roleTitle?: string;
  expertise?: string;
  personality?: string;
  boundaries?: string;
  customInstructions?: string;
  modelProvider?: string;
  modelId?: string;
  capabilities?: string;
  allowedToolScope?: string;
  allowedTools?: string;
  enabled?: boolean;
  respondToMentions?: boolean;
  respondToDms?: boolean;
  webhookUrl?: string;
}

const ALLOWED_SCOPES = [
  "all",
  "internal_only",
  "custom",
  "capabilities",
] as const;
type AllowedScope = (typeof ALLOWED_SCOPES)[number];

/**
 * `ano coworker update <coworker-id> [--field value …]`
 *   — wraps the manifest `coworker_update` server op. Pass only the
 *   fields you want to change; omitted flags leave the existing value
 *   alone. When `--enabled` flips, the coworker DMs an "Agent paused"
 *   / "Agent resumed" note into every DM it still belongs to.
 */
export function registerCoworkerUpdate(parent: Command): void {
  parent
    .command("update <coworker-id>")
    .description(
      "Update an existing coworker's config (display name, role, custom instructions, model, capabilities, enabled, etc.). Caller must be a workspace admin. Pass only the fields you want to change.",
    )
    .option("--display-name <name>", "New display name (≤100 chars)")
    .option("--avatar-url <url>", "Avatar URL on the underlying user")
    .option("--role-title <title>", "Short label for the coworker's role")
    .option("--expertise <text>", "What the coworker is good at (≤2000 chars)")
    .option("--personality <text>", "Tone / persona (≤2000 chars)")
    .option(
      "--boundaries <text>",
      "What the coworker should NOT do (≤2000 chars)",
    )
    .option(
      "--custom-instructions <text>",
      "Free-form instructions that prepend to every prompt (≤50000 chars)",
    )
    .option("--model-provider <name>", "anthropic-managed | google | …")
    .option("--model-id <id>", "Model identifier")
    .option(
      "--capabilities <slugs>",
      "Comma-separated capability slugs. Auto-sets allowed-tool-scope to 'capabilities' if not explicitly set.",
    )
    .option(
      "--allowed-tool-scope <scope>",
      "all | internal_only | custom | capabilities",
    )
    .option(
      "--allowed-tools <names>",
      "Comma-separated tool names (used with allowed-tool-scope=custom)",
    )
    .option(
      "--enabled <bool>",
      "Enable / disable the coworker (true|false). Toggling sends a pause/resume DM.",
      (v) => v === "true",
    )
    .option(
      "--respond-to-mentions <bool>",
      "Whether @mentions trigger a reply (true|false)",
      (v) => v === "true",
    )
    .option(
      "--respond-to-dms <bool>",
      "Whether DMs trigger a reply (true|false)",
      (v) => v === "true",
    )
    .option(
      "--webhook-url <url>",
      'External-coworker webhook delivery URL (pass "" to clear)',
    )
    .action(
      withErrorHandler(
        async (coworkerId: string, opts: CoworkerUpdateOpts, cmd) => {
          const globals = cmd.optsWithGlobals() as GlobalOptions;
          const auth = resolveAuth(globals);
          const client = createApiClient(auth);

          const capabilities = opts.capabilities
            ? opts.capabilities
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined;
          const allowed_tools = opts.allowedTools
            ? opts.allowedTools
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined;

          let allowed_tool_scope: AllowedScope | undefined;
          if (opts.allowedToolScope) {
            if (
              !ALLOWED_SCOPES.includes(opts.allowedToolScope as AllowedScope)
            ) {
              throw new Error(
                `--allowed-tool-scope must be one of: ${ALLOWED_SCOPES.join(", ")}`,
              );
            }
            allowed_tool_scope = opts.allowedToolScope as AllowedScope;
          }

          const result = await client.coworkerUpdate({
            coworker_id: coworkerId,
            workspace_id: globals.workspace,
            display_name: opts.displayName,
            avatar_url: opts.avatarUrl,
            role_title: opts.roleTitle,
            expertise: opts.expertise,
            personality: opts.personality,
            boundaries: opts.boundaries,
            custom_instructions: opts.customInstructions,
            model_provider: opts.modelProvider,
            model_id: opts.modelId,
            capabilities,
            allowed_tool_scope,
            allowed_tools,
            enabled: opts.enabled,
            respond_to_mentions: opts.respondToMentions,
            respond_to_dms: opts.respondToDms,
            webhook_url:
              opts.webhookUrl === undefined
                ? undefined
                : opts.webhookUrl === ""
                  ? null
                  : opts.webhookUrl,
          });

          output(globals, {
            data: result,
            title: `Coworker ${coworkerId} updated`,
            breadcrumbs: [
              {
                action: "list_users",
                cmd: "ano users list --agent",
                description: "Confirm the updated config in workspace users",
              },
            ],
          });
        },
      ),
    );
}
