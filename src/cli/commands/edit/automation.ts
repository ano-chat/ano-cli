/**
 * `ano edit automation <id>` — kicks off a CC-guided flow to edit an
 * existing Ano automation.
 *
 * Mirrors `ano new automation` but loads the current plan first and
 * asks CC to walk the user through changes. Edits use the
 * `automation_update` MCP tool — in-place, preserves run history and
 * the existing webhook URL. Falls back to delete-then-recreate only
 * when the user's edit changes the trigger_type to/from `webhook`
 * (the webhook token is keyed on the automation row).
 *
 * Optional trailing positional args become the user's intent for what
 * to change (e.g. `ano edit automation auto_xyz "change the channel
 * to #growth-eu"`), so the desktop's Edit button can pre-load CC.
 */
import { Command } from "commander";
import { spawn } from "node:child_process";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import type { GlobalOptions } from "../../types.js";

const BOOTSTRAP_HEADER = [
  "**You are helping me edit an existing Ano automation.** An Ano automation is a recurring job that lives in my Ano workspace and runs 24/7 on Ano's servers.",
  "",
  "## What you must NOT do",
  "Do NOT invoke any of these CC built-ins: `schedule` skill, `CronCreate`, `CronList`, `CronDelete`, `ScheduleWakeup`, or any cron/loop primitive. Use Ano's MCP tools only.",
  "",
  "Do NOT call `automation_compile` or `automation_create_from_text` — you're an LLM, compile the updated plan yourself.",
  "",
  "## How edits work",
  "Use the `automation_update` MCP tool. It applies edits **in place** — the automation id stays the same, run history is preserved, and the webhook URL keeps working. Pass only the fields that changed (name, trigger_type, trigger_config, actions, visibility, enabled). Unspecified fields keep their current value.",
  "",
  "Exceptions where you should fall back to delete-then-recreate (`automation_delete` → `automation_create_compiled` → `automation_webhook_setup` if webhook):",
  "- The user wants to change `trigger_type` **to** `webhook` (need to mint a fresh URL + secret).",
  "- The user wants to change `trigger_type` **from** `webhook` to something else (the old URL becomes meaningless and should be invalidated).",
  "",
  "Otherwise prefer `automation_update`.",
  "",
  "## Your job",
  "Walk me through the edit, **one question at a time**:",
  "",
  "1. **Show + ask** — show me a short readable summary of the current automation (NOT raw JSON), then ask what I want to change.",
  "2. **Build the diff** — apply my changes to the existing plan; only the fields that actually differ go into the `automation_update` payload.",
  '3. **Confirm** — show the change in plain English ("Trigger stays the same, channel changes from #growth to #growth-eu"), and ask me to confirm. Only mention run-history loss / webhook URL change if you have to fall back to delete-then-recreate (per the exceptions above).',
  "4. **Apply** — call `automation_update` with just the changed fields. (Or, for the webhook trigger-type changes only, do delete-then-recreate.)",
  "5. **Confirm done** — tell me the edit is live.",
  "",
  "## Constraints",
  "- One question per turn. Plain language. Short responses.",
  "- Reference the automation by name when talking to me, not by id.",
  "- Only pass the fields that changed to `automation_update` — don't echo back the entire plan.",
];

export function registerEditAutomation(parent: Command): void {
  parent
    .command("automation <id> [request...]")
    .description(
      "Edit an existing Ano automation, guided by Claude Code. Optionally pass a one-line description of the change as the request.",
    )
    .action(async (id: string, request: string[] | undefined, _opts, cmd) => {
      const globals = cmd.optsWithGlobals() as GlobalOptions;
      const auth = resolveAuth(globals);
      const client = createApiClient(auth);

      // Fetch current state so CC can show it back to the user.
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
      const promptParts = [
        ...BOOTSTRAP_HEADER,
        "",
        `## Current automation (id: ${id})`,
        "",
        "```json",
        JSON.stringify(current, null, 2),
        "```",
        "",
      ];
      if (userIntent) {
        promptParts.push(
          "## My change request",
          "",
          userIntent,
          "",
          "Use this as your starting context — confirm you understand what I want, ask any follow-up questions one at a time, then move through the workflow above.",
        );
      } else {
        promptParts.push(
          "Now show me the current automation in plain English (not JSON) and ask what I want to change.",
        );
      }
      const prompt = promptParts.join("\n");

      const child = spawn("claude", [prompt], {
        stdio: "inherit",
        shell: false,
      });
      child.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") {
          process.stderr.write(
            "Claude Code isn't installed. Install it from https://claude.com/claude-code, then run `ano edit automation` again.\n",
          );
          process.exit(127);
        }
        process.stderr.write(`Failed to launch Claude Code: ${err.message}\n`);
        process.exit(1);
      });
      child.on("exit", (code) => {
        process.exit(code ?? 0);
      });
    });
}
