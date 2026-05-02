import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

interface RunsOpts {
  limit?: string;
}

export function registerAutomationRuns(parent: Command): void {
  parent
    .command("runs <automation-id>")
    .description("Show recent runs for an automation")
    .option("--limit <n>", "Max rows (default: 50)", "50")
    .action(
      withErrorHandler(async (automationId: string, opts: RunsOpts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const result = await client.automationRuns({
          automation_id: automationId,
          limit: Number(opts.limit ?? 50),
        });
        output(globals, {
          data: result.runs,
          columns: ["id", "started_at", "status", "duration_ms", "error"],
          title: `Runs · ${automationId}`,
        });
      }),
    );
}
