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
// Strategy: drive everything through the `ano` CLI via Bash. CC compiles
// the plan in-LLM (it IS the LLM) and saves via `ano automation
// create-compiled` — which takes a JSON plan on stdin or from a file
// and persists it server-side without a redundant LLM call.
const SYSTEM_PROMPT = [
  "Help the user create an Ano automation — a server-side recurring job that runs 24/7 even when their laptop is closed.",
  "",
  "## Tools",
  "Use the Bash tool with `ano` CLI commands. The user is in their own Shell; `ano` is on PATH.",
  "- Channels lookup: `ano channels list -j` (JSON output)",
  "- Save plan: `echo '<plan-json>' | ano automation create-compiled` (or `ano automation create-compiled --file plan.json`)",
  "- Webhook setup (after save, only if `trigger_type=webhook`): `ano automation webhook-setup <id>`",
  "",
  "## DO NOT",
  "- Do NOT run `ano automation compile` — that does a redundant server-side LLM call. **You** are the LLM here; compile the plan yourself.",
  "- Do NOT run `ano automation create` (one-shot) — also does server-side compile.",
  "- Do NOT use CC's `schedule` skill, `CronCreate`/`CronList`/`CronDelete`, `ScheduleWakeup` — those schedule things inside *this* Shell and vanish when it closes. Wrong layer.",
  "",
  "## Plan shape",
  "```json",
  "{",
  '  "name": "<short label>",',
  '  "trigger_type": "schedule" | "message_match" | "mention" | "channel_event" | "webhook",',
  '  "trigger_config": { /* type-specific: cron+tz, channel_id+pattern, channel_id+event_type, etc */ },',
  '  "actions": [{ "tool": "send_message" | "send_dm" | "sql_query" | "http_request" | "run_skill", "args": { /* tool-specific */ } }]',
  "}",
  "```",
  "",
  "## Flow",
  "1. Ask one short question per turn: trigger type → trigger config → actions.",
  "2. Confirm the plan in plain English before saving (e.g. \"Every weekday at 9am → post 'gm' to #growth — sound right?\").",
  "3. After confirmation, build the JSON and save via `echo '<plan>' | ano automation create-compiled`.",
  "4. If `trigger_type=webhook`: also run `ano automation webhook-setup <id>` (id comes from step 3's output) and show the URL+secret to the user.",
  "5. Tell the user the automation is live + when it'll first fire, and suggest they check `/automations` in Ano.",
  "",
  "Plain language until the final summary. Short responses. Pick sensible defaults when vague (9 AM workspace time, etc.) and call them out.",
].join("\n");

const KICKOFF =
  'Open with exactly: "Let\'s set up an automation. What should trigger it — a schedule, a webhook, a reaction, an @-mention, or a channel event?" Wait for my answer before continuing. Do not run any tools yet.';

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
