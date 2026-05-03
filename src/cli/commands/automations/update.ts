import { readFile } from "node:fs/promises";
import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

interface UpdateOpts {
  name?: string;
  description?: string;
  visibility?: "personal" | "workspace";
  enabled?: string;
  triggerType?:
    | "schedule"
    | "message_match"
    | "mention"
    | "channel_event"
    | "webhook";
  triggerConfig?: string;
  actions?: string;
  fromFile?: string;
}

interface PlanFromFile {
  name?: string;
  description?: string;
  visibility?: "personal" | "workspace";
  enabled?: boolean;
  trigger_type?:
    | "schedule"
    | "message_match"
    | "mention"
    | "channel_event"
    | "webhook";
  trigger_config?: Record<string, unknown>;
  actions?: Array<{ tool: string; args: Record<string, unknown> }>;
}

export function registerAutomationUpdate(parent: Command): void {
  parent
    .command("update <id>")
    .description(
      "Edit an automation in place — preserves run history, webhook URL, and the automation id. Pass only the fields you want to change.",
    )
    .option("--name <name>", "New name")
    .option("--description <text>", "New description")
    .option("--visibility <visibility>", "personal | workspace")
    .option(
      "--enabled <bool>",
      "true | false (toggles the enabled flag without rotating)",
    )
    .option(
      "--trigger-type <type>",
      "schedule | message_match | mention | channel_event | webhook",
    )
    .option(
      "--trigger-config <json>",
      "JSON object replacing trigger_config wholesale",
    )
    .option("--actions <json>", "JSON array replacing actions wholesale")
    .option(
      "--from-file <path>",
      "JSON file with any of the above keys (snake_case). Field-flag overrides take precedence.",
    )
    .action(
      withErrorHandler(async (id: string, opts: UpdateOpts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        // Build the update payload from --from-file (if any) + flag
        // overrides. Flags win.
        const fromFile: PlanFromFile = opts.fromFile
          ? (JSON.parse(await readFile(opts.fromFile, "utf8")) as PlanFromFile)
          : {};

        const payload: Parameters<typeof client.automationUpdate>[0] = {
          automation_id: id,
        };
        if (fromFile.name !== undefined) payload.name = fromFile.name;
        if (fromFile.description !== undefined)
          payload.description = fromFile.description;
        if (fromFile.visibility !== undefined)
          payload.visibility = fromFile.visibility;
        if (fromFile.enabled !== undefined) payload.enabled = fromFile.enabled;
        if (fromFile.trigger_type !== undefined)
          payload.trigger_type = fromFile.trigger_type;
        if (fromFile.trigger_config !== undefined)
          payload.trigger_config = fromFile.trigger_config;
        if (fromFile.actions !== undefined) payload.actions = fromFile.actions;

        if (opts.name !== undefined) payload.name = opts.name;
        if (opts.description !== undefined)
          payload.description = opts.description;
        if (opts.visibility !== undefined) payload.visibility = opts.visibility;
        if (opts.enabled !== undefined) {
          if (opts.enabled !== "true" && opts.enabled !== "false") {
            throw new Error(`--enabled must be "true" or "false"`);
          }
          payload.enabled = opts.enabled === "true";
        }
        if (opts.triggerType !== undefined)
          payload.trigger_type = opts.triggerType;
        if (opts.triggerConfig !== undefined) {
          payload.trigger_config = JSON.parse(opts.triggerConfig);
        }
        if (opts.actions !== undefined) {
          payload.actions = JSON.parse(opts.actions);
        }

        const result = await client.automationUpdate(payload);
        output(globals, {
          data: result,
          title: "Automation Updated",
          breadcrumbs: [
            {
              action: "automation_runs",
              cmd: `ano automation runs ${id}`,
              description: "Run history (preserved)",
            },
          ],
        });
      }),
    );
}
