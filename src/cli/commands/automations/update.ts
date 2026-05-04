import { readFile } from "node:fs/promises";
import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import { slugFromId } from "../../../util/slug.js";
import { parseDuration } from "../../../util/parse-duration.js";
import { resolveAutomation } from "./resolve-automation.js";

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
  /** "none" / "null" / "0" / negative removes the cap. */
  maxRuns?: string;
  /** Relative duration ("5 weeks") added to Date.now(). "none" removes. */
  expiresIn?: string;
  /** ISO date / epoch ms/sec. "none" removes. Wins over --expires-in. */
  expiresAt?: string;
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
  max_runs?: number | null;
  expires_at?: number | null;
}

/** "none" / "null" / "0" / negative ⇒ null (remove cap). */
function resolveMaxRunsUpdate(
  value: string | undefined,
): number | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "none" || trimmed === "null" || trimmed === "") return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n)) {
    throw new Error(
      `--max-runs must be a positive integer or "none", got "${value}".`,
    );
  }
  if (n <= 0) return null;
  return n;
}

/** "none"/"null"/"" ⇒ null. ISO or epoch ms/sec accepted. */
function resolveExpiryUpdate(opts: {
  expiresIn?: string;
  expiresAt?: string;
}): number | null | undefined {
  const removeTokens = new Set(["none", "null", ""]);
  if (opts.expiresAt !== undefined) {
    const trimmed = opts.expiresAt.trim();
    if (removeTokens.has(trimmed.toLowerCase())) return null;
    const numeric = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
    if (Number.isFinite(numeric)) {
      return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isFinite(parsed)) {
      throw new Error(
        `--expires-at must be ISO date, epoch ms/sec, or "none", got "${opts.expiresAt}".`,
      );
    }
    return parsed;
  }
  if (opts.expiresIn !== undefined) {
    const trimmed = opts.expiresIn.trim();
    if (removeTokens.has(trimmed.toLowerCase())) return null;
    return Date.now() + parseDuration(trimmed);
  }
  return undefined;
}

export function registerAutomationUpdate(parent: Command): void {
  parent
    .command("update <slug-or-id>")
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
      "--max-runs <n-or-none>",
      "Set or change run cap. Positive int = cap, 'none' = unlimited.",
    )
    .option(
      "--expires-in <duration-or-none>",
      "Set expiry as a relative duration ('5 weeks', '12h'). 'none' removes expiry.",
    )
    .option(
      "--expires-at <iso-or-epoch-or-none>",
      "Set expiry as an absolute time (ISO or epoch ms/sec). 'none' removes expiry. Wins over --expires-in.",
    )
    .option(
      "--from-file <path>",
      "JSON file with any of the above keys (snake_case). Field-flag overrides take precedence.",
    )
    .action(
      withErrorHandler(async (input: string, opts: UpdateOpts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const automationId = await resolveAutomation({
          client,
          workspace: globals.workspace,
          input,
        });

        // Build the update payload from --from-file (if any) + flag
        // overrides. Flags win.
        const fromFile: PlanFromFile = opts.fromFile
          ? (JSON.parse(await readFile(opts.fromFile, "utf8")) as PlanFromFile)
          : {};

        const payload: Parameters<typeof client.automationUpdate>[0] = {
          automation_id: automationId,
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
        if (fromFile.max_runs !== undefined)
          payload.max_runs = fromFile.max_runs;
        if (fromFile.expires_at !== undefined)
          payload.expires_at = fromFile.expires_at;

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
        const maxRunsFlag = resolveMaxRunsUpdate(opts.maxRuns);
        if (maxRunsFlag !== undefined) payload.max_runs = maxRunsFlag;
        const expiresFlag = resolveExpiryUpdate({
          expiresIn: opts.expiresIn,
          expiresAt: opts.expiresAt,
        });
        if (expiresFlag !== undefined) payload.expires_at = expiresFlag;

        const result = await client.automationUpdate(payload);
        output(globals, {
          data: result,
          title: "Automation Updated",
          breadcrumbs: [
            {
              action: "automation_runs",
              cmd: `ano automation runs ${slugFromId(automationId)}`,
              description: "Run history (preserved)",
            },
          ],
        });
      }),
    );
}
