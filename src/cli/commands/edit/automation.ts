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

const SYSTEM_PROMPT = [
  "Help the user edit an existing Ano automation in place.",
  "",
  "Use `automation_update` (preserves id, run history, webhook URL). Pass only the fields that changed.",
  "",
  "Exception — fall back to `automation_delete` + `automation_create_compiled` + (if webhook) `automation_webhook_setup` ONLY when changing `trigger_type` to/from `webhook`. Otherwise always update.",
  "",
  "DO NOT use: `schedule` skill, `CronCreate`/`CronList`/`CronDelete`, `ScheduleWakeup`, `automation_compile`, `automation_create_from_text`.",
  "",
  "Flow: show the current automation in plain English (not JSON), ask what to change, confirm the diff, apply via `automation_update`. One short question per turn. Reference the automation by name, not id.",
].join("\n");

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
      const userPrompt = [
        `Current automation (id: ${id}):`,
        "```json",
        JSON.stringify(current, null, 2),
        "```",
        "",
        userIntent
          ? `My change request: ${userIntent}\n\nConfirm you understand, then move through the flow.`
          : "Show me the current automation in plain English (not JSON) and ask what I want to change.",
      ].join("\n");

      // Speed: Haiku + low effort + skip slash skills (also blocks the
      // built-in `/schedule` hijack).
      const args = [
        "--model",
        "claude-haiku-4-5-20251001",
        "--effort",
        "low",
        "--disable-slash-commands",
        "--append-system-prompt",
        SYSTEM_PROMPT,
        userPrompt,
      ];
      const child = spawn("claude", args, {
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
