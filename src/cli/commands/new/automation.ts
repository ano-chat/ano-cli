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

const BOOTSTRAP = [
  "**You are helping me create an Ano automation.** An Ano automation is a recurring job that lives in my Ano workspace and runs 24/7 on Ano's servers — even when this Shell is closed and my laptop is off.",
  "",
  "## What you must NOT do",
  "Do NOT invoke any of these CC built-ins: `schedule` skill, `CronCreate`, `CronList`, `CronDelete`, `ScheduleWakeup`, or any cron/loop primitive. Those schedule things inside *this* Claude Code session — they vanish when the Shell closes. Wrong layer. Use Ano's MCP tools instead.",
  "",
  "Also do NOT call `automation_compile` or `automation_create_from_text` — those exist for the CLI (where there's no LLM in the loop). You're an LLM in this conversation; compile the plan yourself and save it directly with `automation_create_compiled`.",
  "",
  "## Your job",
  "Walk me through creating the automation, **one question at a time**, in this order:",
  "",
  '1. **Greeting + first question** — open with: "Got it — let\'s set up an automation. First, what should *trigger* it? You can pick:" then list the 5 trigger types in plain English (a schedule, a message reaction, a webhook from another service, an @-mention, or a channel event).',
  "2. **Trigger config** — once I pick a type, ask for the specifics (cron expression / channel + regex / event type / etc.). Pick sensible defaults if I'm vague.",
  "3. **Actions** — ask what should happen when the trigger fires. Each action uses one of: `send_message` (post to a channel), `send_dm`, `sql_query`, `http_request`, `run_skill`. Most automations are 1-3 steps.",
  '4. **Confirm** — show me the plan as a readable summary BEFORE saving (e.g. "Every weekday at 9am → query Postgres → post count to #growth"), and ask me to confirm.',
  "5. **Save** — call `automation_create_compiled` with the structured JSON: `{ name, trigger_type, trigger_config, actions[] }`. Use `list_channels` first if you need channel ids.",
  "6. **Webhook setup** — if `trigger_type === 'webhook'`, call `automation_webhook_setup` with the returned id and show me the URL + signing secret + signing format (HMAC-SHA256 over `${X-Ano-Timestamp}.${body}`). Tell me to save the secret now since it's only shown once.",
  "7. **Confirm done** — tell me the automation is live, what time it'll first fire (or that it's waiting for the webhook), and that I can check it on the Automations page.",
  "",
  "## Constraints",
  "- One question per turn. Don't dump a wall of questions.",
  "- Use plain language — no JSON or technical jargon in your messages until step 4 (the confirmation summary).",
  "- Keep responses short. Short questions, short confirmations.",
  '- If I\'m vague ("every morning"), pick a sensible default (9:00 AM in workspace timezone) and call it out: "I\'ll go with 9 AM, sound right?"',
  "",
  "Now open with the greeting + the trigger-type question.",
].join("\n");

export function registerNewAutomation(parent: Command): void {
  parent
    .command("automation [request...]")
    .description(
      'Create a new Ano automation, guided by Claude Code. Optionally pass a one-line description as the request (e.g. `ano new automation "every weekday at 9am post yesterday\'s signups to #growth"`).',
    )
    .action((request: string[] | undefined) => {
      const userIntent = (request ?? []).join(" ").trim();
      const prompt = userIntent
        ? `${BOOTSTRAP}\n\n## My request\n\n${userIntent}\n\nUse this as your starting context — confirm the trigger type with me first, then move through the workflow above.`
        : BOOTSTRAP;
      const child = spawn("claude", [prompt], {
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
