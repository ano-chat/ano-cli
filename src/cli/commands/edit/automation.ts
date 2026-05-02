/**
 * `ano edit automation <id>` — kicks off a CC-guided flow to edit an
 * existing Ano automation.
 *
 * Mirrors `ano new automation` but loads the current plan first and
 * asks CC to walk the user through changes. Today's edit path uses
 * delete-then-recreate (we don't have an `automation_update` MCP tool
 * yet); the bootstrap calls that out and warns that the run history
 * for the old row will be lost.
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
  "## How edits work today",
  "There's no in-place `automation_update` MCP tool yet, so edits are delete-then-recreate:",
  "1. Use `automation_delete` to remove the old row (this loses run history).",
  "2. Use `automation_create_compiled` to register the new plan with the user's changes applied.",
  "3. If the trigger is `webhook`, also call `automation_webhook_setup` after to mint a fresh URL + secret. The old webhook URL stops working after the delete.",
  "",
  "**Mention the run-history loss + webhook-url change in your confirmation step BEFORE you delete the old one.**",
  "",
  "## Your job",
  "Walk me through the edit, **one question at a time**:",
  "",
  "1. **Show + ask** — show me a short readable summary of the current automation (NOT raw JSON), then ask what I want to change.",
  "2. **Build the new plan** — apply my changes to the existing plan to produce a new structured JSON.",
  '3. **Confirm** — show the diff in plain English ("Trigger stays the same, channel changes from #growth to #growth-eu"), warn about run-history loss + webhook URL change if applicable, and ask me to confirm.',
  "4. **Apply** — call `automation_delete` then `automation_create_compiled`. If webhook, also call `automation_webhook_setup` and show me the new URL + secret.",
  "5. **Confirm done** — tell me the edited automation is live.",
  "",
  "## Constraints",
  "- One question per turn. Plain language. Short responses.",
  "- Reference the automation by name when talking to me, not by id.",
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
