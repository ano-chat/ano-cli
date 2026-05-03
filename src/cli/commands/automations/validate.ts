import { readFile } from "node:fs/promises";
import { Command } from "commander";

import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

interface ValidateOpts {
  file?: string;
}

/**
 * `ano automation validate` — schema + safety-lint check on a plan
 * without submitting it. Pairs with `ano automation compile` so an
 * orchestrator (Claude Code) can build a plan in chat, validate it,
 * and only then submit via `ano automation create-compiled`.
 */
export function registerAutomationValidate(parent: Command): void {
  parent
    .command("validate")
    .description(
      "Validate a compiled-plan JSON (schema + safety lint) WITHOUT saving. Use before `automation create-compiled` to catch issues offline.",
    )
    .option(
      "--file <path>",
      "Path to a JSON file with the compiled plan. If omitted, reads stdin.",
    )
    .action(
      withErrorHandler(async (opts: ValidateOpts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        const raw = opts.file
          ? await readFile(opts.file, "utf8")
          : await readStdin();
        let plan: unknown;
        try {
          plan = JSON.parse(raw);
        } catch (err) {
          throw new Error(
            `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        const result = await client.automationValidate({
          plan,
          workspace_id: globals.workspace,
        });

        output(globals, {
          data: result,
          title: result.ok
            ? `Validation passed (${result.warnings.length} warning${
                result.warnings.length === 1 ? "" : "s"
              })`
            : `Validation FAILED (${result.schema_errors.length} schema error${
                result.schema_errors.length === 1 ? "" : "s"
              })`,
          breadcrumbs: result.ok
            ? [
                {
                  action: "automation_create_compiled",
                  cmd: "ano automation create-compiled --file <plan.json>",
                  description: "Submit the validated plan to Ano",
                },
              ]
            : [
                {
                  action: "automation_compile",
                  cmd: "ano automation compile <prompt>",
                  description:
                    "Re-compile from a natural-language prompt and try again",
                },
              ],
        });
      }),
    );
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error(
      'No --file provided and stdin is a TTY. Pipe a plan: `ano automation compile "..." | ano automation validate` or pass --file <path>.',
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
