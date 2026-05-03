/**
 * `ano new automation` — kicks off a guided flow in Claude Code that
 * creates a new Ano automation through the Ano MCP server.
 *
 * The user typed this from a terminal (or it was dispatched from the
 * desktop's +New button on /automations). We spawn `claude` with a
 * bootstrap prompt that primes CC to ask clarifying questions, build a
 * structured plan, and call the `automation_create_compiled` MCP tool.
 *
 * Why a thin wrapper around `claude` instead of a pure CLI prompt: CC
 * is already configured with the Ano MCP, so it can resolve channel
 * ids, look up the user's workspace context, and produce a structured
 * plan in one shot. The CLI doesn't need its own LLM call.
 */
import { Command } from "commander";
import { spawn } from "node:child_process";

// Tight system prompt — passed via --append-system-prompt so CC has a
// strong steering signal without re-reading a wall of text every turn.
// Key constraints baked in: don't use cron/schedule primitives (those
// schedule inside CC and vanish), don't call compile/create_from_text
// (those exist for non-LLM CLI callers), do compile the plan yourself
// and save with `automation_create_compiled`.
const SYSTEM_PROMPT = [
  "Help the user create an Ano automation — a server-side recurring job that runs 24/7 even when their laptop is closed.",
  "",
  "Use ONLY Ano's MCP tools: `automation_create_compiled` (save plan), `automation_webhook_setup` (mint URL+secret if webhook), `list_channels` (resolve channel ids).",
  "",
  "DO NOT use: `schedule` skill, `CronCreate`/`CronList`/`CronDelete`, `ScheduleWakeup`, `automation_compile`, `automation_create_from_text`. Those are wrong layer.",
  "",
  "Trigger types: schedule (cron), message_match (regex on channel), mention, channel_event, webhook.",
  "Action tools: send_message, send_dm, sql_query, http_request, run_skill.",
  "",
  "Flow: ask one short question per turn (trigger? config? actions?). Confirm in plain English before saving. Save via `automation_create_compiled`. If webhook, also call `automation_webhook_setup` and show URL+secret. Pick sensible defaults when vague (9 AM workspace time, etc.) and call them out.",
  "",
  "Plain language until the final summary. Short responses.",
].join("\n");

const KICKOFF =
  'Open with: "Let\'s set up an automation. What should trigger it — a schedule, a webhook, a reaction, an @-mention, or a channel event?" Wait for my answer before continuing.';

export function registerNewAutomation(parent: Command): void {
  parent
    .command("automation [request...]")
    .description(
      'Create a new Ano automation, guided by Claude Code. Optionally pass a one-line description as the request (e.g. `ano new automation "every weekday at 9am post yesterday\'s signups to #growth"`).',
    )
    .action((request: string[] | undefined) => {
      const userIntent = (request ?? []).join(" ").trim();
      // First user-prompt: either the kickoff (open the conversation) or
      // the user's pre-supplied intent (skip straight to the trigger
      // question with that context).
      const userPrompt = userIntent
        ? `My request: ${userIntent}\n\nConfirm the trigger type with me, then move through the workflow.`
        : KICKOFF;

      // Speed: Haiku for ~3-4x faster turns vs Sonnet/Opus, low effort,
      // skip slash skills (also blocks the built-in `/schedule` hijack).
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
            "Claude Code isn't installed. Install it from https://claude.com/claude-code, then run `ano new automation` again.\n",
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
