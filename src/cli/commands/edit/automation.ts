/**
 * `ano edit automation <id>` — print the current plan + edit recipe,
 * exit immediately.
 *
 * Same shape as `ano new automation` — never spawns a child claude.
 * The runtime where this is invoked IS Claude Code, so the parent
 * session reads the output and walks the user through the change.
 *
 * Mirrors `ano new automation` but loads the current plan first so
 * the surrounding CC can show the user the existing config + ask
 * what to change. Edits use the `automation_update` MCP tool —
 * in-place, preserves run history and the existing webhook URL.
 *
 * Optional trailing positional args become the user's intent for what
 * to change (e.g. `ano edit automation auto_xyz "change the channel
 * to #growth-eu"`), so the desktop's Edit button can pre-load CC.
 */
import { Command } from "commander";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import type { GlobalOptions } from "../../types.js";

function renderInstructions(
  id: string,
  current: unknown,
  userIntent: string,
): string {
  const intentBlock = userIntent
    ? `User change request (already given): "${userIntent}"\n\nConfirm you understand, propose the diff in plain English, then apply.`
    : 'Step 1 — show the user the current automation in plain English (NOT JSON).\n  Ask: "What would you like to change?"';

  return [
    "═══ Edit an existing Ano automation ══════════════════════════════════════",
    "",
    "You (the surrounding Claude Code session) are the agent. Walk the user",
    "through the edit using the `ano` CLI directly — DO NOT spawn a child",
    "claude.",
    "",
    `Automation id: ${id}`,
    "",
    "Current plan (JSON for your reference — do NOT show this to the user):",
    "",
    JSON.stringify(current, null, 2),
    "",
    intentBlock,
    "",
    "Step 2 — confirm the diff in plain English (NOT JSON) before running.",
    "  e.g. \"I'll change the channel from #foundations → #engineering and",
    '       leave the schedule unchanged. Confirm?"',
    "",
    "Step 3 — apply in place (preserves id, run history, webhook URL):",
    `  ano automation update ${id} --name '...' --agent`,
    `  ano automation update ${id} --enabled true --agent`,
    `  ano automation update ${id} --trigger-config '<json>' --agent`,
    `  ano automation update ${id} --actions '<json>' --agent`,
    "",
    "  Pass only the fields that changed.",
    "",
    "Step 4 — webhook trigger transitions (only when changing trigger_type",
    "         to/from `webhook`): the URL + secret will need to be reissued.",
    "  Tell the user this BEFORE running, then:",
    `    ano automation update ${id} --trigger-type webhook --agent`,
    `    ano automation webhook-setup ${id} --agent`,
    "  Show the user the new URL + secret in the response.",
    "",
    "Step 5 — confirm done in plain English.",
    "",
    "DO NOT:",
    "  • Run `ano automation compile` or `ano automation create` — redundant",
    "    server-side LLM. You are the LLM here.",
    "  • Use CronCreate / CronList / CronDelete / ScheduleWakeup — those",
    "    schedule inside the surrounding Shell session and vanish on exit.",
    "  • Delete-then-recreate to change a cron — `update --trigger-config`",
    "    is in-place and preserves run history.",
    "═══════════════════════════════════════════════════════════════════════════",
  ].join("\n");
}

export function registerEditAutomation(parent: Command): void {
  parent
    .command("automation <id> [request...]")
    .description(
      "Print the current automation plan + edit recipe for the surrounding Claude Code to apply changes via `ano automation update`. Optionally pass a one-line change description as the request.",
    )
    .action(async (id: string, request: string[] | undefined, _opts, cmd) => {
      const globals = cmd.optsWithGlobals() as GlobalOptions;
      const auth = resolveAuth(globals);
      const client = createApiClient(auth);

      // Fetch current state so the agent can show it to the user.
      let current: unknown = null;
      try {
        const list = await client.automationList({
          workspace_id: globals.workspace,
        });
        current = (list.automations ?? []).find((a) => a.id === id) ?? null;
      } catch (err) {
        process.stderr.write(
          `Warning: could not fetch automation ${id}: ${(err as Error).message}\n`,
        );
      }

      if (!current) {
        process.stderr.write(
          `No automation found with id ${id} in this workspace. Run \`ano automation list\` to see what's available.\n`,
        );
        process.exit(1);
      }

      const userIntent = (request ?? []).join(" ").trim();
      process.stdout.write(renderInstructions(id, current, userIntent) + "\n");
    });
}
