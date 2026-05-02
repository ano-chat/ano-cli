import { readFile } from "node:fs/promises";
import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

interface CreateCompiledOpts {
  file?: string;
  visibility?: "personal" | "workspace";
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
    .action(
      withErrorHandler(async (opts: CreateCompiledOpts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        const raw = opts.file
          ? await readFile(opts.file, "utf8")
          : await readStdin();
        const parsed = parsePlan(raw);

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
