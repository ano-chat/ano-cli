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
  "## Tools",
  "Drive everything via the `ano` CLI in Bash. The user is in their own Shell; `ano` is on PATH.",
  "- In-place update (preserves id, run history, webhook URL):",
  "    `ano automation update <id> --name '...' --enabled true|false ...`",
  "    Common flags: `--name`, `--description`, `--enabled`, `--visibility`,",
  "    `--trigger-type`, `--trigger-config '<json>'`, `--actions '<json>'`.",
  "    Pass only the fields that changed.",
  "- Webhook URL/secret rotation (only when changing trigger_type to/from `webhook`):",
  "    `ano automation webhook-setup <id>`",
  "",
  "## DO NOT",
  "- Do NOT run `ano automation compile` or `ano automation create` — redundant server-side LLM calls. You are the LLM here.",
  "- Do NOT use CC's `schedule` skill, `CronCreate`/`CronList`/`CronDelete`, `ScheduleWakeup`.",
  "- Do NOT delete-then-recreate just to edit a cron expression — `ano automation update --trigger-config '<json>'` is in-place and preserves run history.",
  "",
  "## Flow",
  "1. Show the current automation in plain English (not JSON). Ask what to change.",
  "2. Confirm the diff in plain English before running anything.",
  "3. Apply via `ano automation update <id> ...` with the relevant flags.",
  "4. Exception — if `trigger_type` changes to/from `webhook`: tell the user the URL+secret will need to be reissued, then run update + `ano automation webhook-setup <id>` and show the new URL+secret.",
  "5. Confirm done.",
  "",
  "One short question per turn. Reference the automation by name, not id.",
].join("\n");

export function registerEditAutomation(parent: Command): void {
  parent
    .command("automation <id> [request...]")
    .description(
      "Edit an existing Ano automation, guided by Claude Code. Optionally pass a one-line description of the change as the request.",
    )
    .action(async (id: string, request: string[] | undefined, _opts, cmd) => {
      const globals = cmd.optsWithGlobals() as GlobalOptions;

      // Hard exit when stdin isn't a TTY — same reasoning as `ano new
      // automation`. The multi-turn child-claude flow can't survive a
      // non-interactive caller. From inside Claude Code, use field-level
      // updates via `ano automation update <id> --name "..." --agent` (or
      // similar single-shot flags) instead.
      if (!process.stdin.isTTY) {
        process.stderr.write(
          "ano edit automation requires an interactive terminal — it spawns a multi-turn chat in Claude Code.\n\n" +
            "If you're running this from inside a Claude Code session (Bash tool), use single-shot field updates:\n" +
            `  ano automation update ${id} --name "..." --agent\n` +
            `  ano automation update ${id} --enabled true --agent\n` +
            "Or compose a fresh plan and resubmit via `ano automation create-compiled`.\n",
        );
        process.exit(2);
      }

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
