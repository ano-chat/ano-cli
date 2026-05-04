import { readFile } from "node:fs/promises";
import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import { parseDuration } from "../../../util/parse-duration.js";

interface CreateCompiledOpts {
  file?: string;
  visibility?: "personal" | "workspace";
  /**
   * Optional run cap (positive integer). Flag overrides any
   * `max_runs` value in the plan file.
   */
  maxRuns?: string;
  /** Relative duration ("5 weeks", "12h"). Computed against Date.now(). */
  expiresIn?: string;
  /** Absolute ISO date or epoch ms/sec. Wins over --expires-in. */
  expiresAt?: string;
}

/** Parse `--max-runs` for create — positive int, throw otherwise. */
function resolveMaxRunsFlag(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0 || String(n) !== trimmed) {
    throw new Error(`--max-runs must be a positive integer, got "${value}".`);
  }
  return n;
}

/**
 * Resolve `--expires-in` / `--expires-at` into an absolute epoch-ms.
 * `--expires-at` wins if both are provided. Returns undefined when
 * neither is set.
 */
function resolveExpiryFlag(opts: CreateCompiledOpts): number | undefined {
  if (opts.expiresAt !== undefined) {
    const trimmed = opts.expiresAt.trim();
    const numeric = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
    if (Number.isFinite(numeric)) {
      // < 10^12 ⇒ seconds (year < 2001 as ms is nonsensical).
      return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isFinite(parsed)) {
      throw new Error(
        `--expires-at must be ISO date or epoch ms/sec, got "${opts.expiresAt}".`,
      );
    }
    return parsed;
  }
  if (opts.expiresIn !== undefined) {
    return Date.now() + parseDuration(opts.expiresIn);
  }
  return undefined;
}

interface CompiledPlanFile {
  name: string;
  trigger_type: string;
  trigger_config?: Record<string, unknown>;
  actions: Array<{ tool: string; args: Record<string, unknown> }>;
  sender_kind?: "bot" | "coworker" | "human";
  coworker_id?: string;
  bot_avatar?: string;
  prompt?: string;
  /** Optional run cap from the plan JSON. Flag overrides take precedence. */
  max_runs?: number | null;
  /** Optional epoch-ms expiry from the plan JSON. Flag overrides take precedence. */
  expires_at?: number | null;
  // Allow `compiled: { ... }` envelope shape too — that's what `ano automation
  // compile` emits, so users can pipe directly: `ano automation compile "..." > plan.json`.
  compiled?: CompiledPlanFile;
}

export function registerAutomationCreateCompiled(parent: Command): void {
  parent
    .command("create-compiled")
    .description(
      "Save a pre-compiled automation plan from a JSON file (or stdin). Pairs with `ano automation compile`.",
    )
    .option(
      "--file <path>",
      "Path to a JSON file with the compiled plan. If omitted, reads stdin.",
    )
    .option(
      "--visibility <visibility>",
      "personal | workspace (default: personal)",
      "personal",
    )
    .option(
      "--max-runs <n>",
      "Cap the automation at N runs. After the cap, the engine auto-disables.",
    )
    .option(
      "--expires-in <duration>",
      "Auto-disable after a relative duration (e.g. '5 weeks', '12h', '30m').",
    )
    .option(
      "--expires-at <iso-or-epoch>",
      "Auto-disable at an absolute time (ISO date, or epoch ms/sec). Wins over --expires-in.",
    )
    .action(
      withErrorHandler(async (opts: CreateCompiledOpts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        const raw = opts.file
          ? await readFile(opts.file, "utf8")
          : await readStdin();
        const parsed = parsePlan(raw);

        if (!globals.workspace) {
          throw new Error(
            "No workspace selected. Run `ano workspaces use <workspace-id>` " +
              "to set the active workspace, or pass `--workspace <workspace-id>` " +
              "to this command. List your workspaces with `ano workspaces list --agent`.",
          );
        }

        // Flag overrides win over plan-file values. Both flag and plan
        // can be omitted (then null/unlimited).
        const flagMaxRuns = resolveMaxRunsFlag(opts.maxRuns);
        const flagExpiresAt = resolveExpiryFlag(opts);
        const max_runs =
          flagMaxRuns !== undefined ? flagMaxRuns : (parsed.max_runs ?? null);
        const expires_at =
          flagExpiresAt !== undefined
            ? flagExpiresAt
            : (parsed.expires_at ?? null);

        const result = await client.automationCreateCompiled({
          workspace_id: globals.workspace,
          name: parsed.name,
          trigger_type: parsed.trigger_type,
          trigger_config: parsed.trigger_config ?? {},
          actions: parsed.actions,
          visibility: opts.visibility,
          sender_kind: parsed.sender_kind,
          coworker_id: parsed.coworker_id,
          bot_avatar: parsed.bot_avatar,
          prompt: parsed.prompt,
          max_runs,
          expires_at,
        });

        output(globals, {
          data: result,
          title: "Automation Saved",
          breadcrumbs: [
            {
              action: "automation_list",
              cmd: "ano automation list",
              description: "List automations in the workspace",
            },
            {
              action: "automation_runs",
              cmd: `ano automation runs ${result.id}`,
              description: "Show run history",
            },
          ],
        });
      }),
    );
}

function parsePlan(raw: string): CompiledPlanFile {
  let parsed: CompiledPlanFile;
  try {
    parsed = JSON.parse(raw) as CompiledPlanFile;
  } catch (err) {
    throw new Error(
      `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // Unwrap the `{ compiled: {...}, warnings: [...] }` shape emitted by
  // `ano automation compile`. Keeps `compile | create-compiled` pipeable.
  const plan = parsed.compiled ?? parsed;
  if (!plan.name || !plan.trigger_type || !Array.isArray(plan.actions)) {
    throw new Error(
      "Plan missing required fields: name, trigger_type, actions[]",
    );
  }
  return plan;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error(
      'No --file provided and stdin is a TTY. Pipe a plan: `ano automation compile "..." | ano automation create-compiled` or pass --file <path>.',
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
