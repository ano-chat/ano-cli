/**
 * `ano new automation` — kicks off a guided flow in Claude Code that
 * creates a new Ano automation.
 *
 * Speed strategy:
 *   1. Pre-fetch workspace context (channels) BEFORE spawning CC, so
 *      CC has all references upfront and never needs a `list_channels`
 *      roundtrip mid-conversation.
 *   2. Compress the conversation: ONE turn to gather intent ("describe
 *      what you want"), CC builds the plan in-LLM, ONE confirmation
 *      turn, then ONE Bash call to `ano automation create-compiled`.
 *   3. Haiku 4.5 + --effort low + --disable-slash-commands for fast
 *      per-turn LLM latency.
 *
 * Total flow: 2 user turns + 1 CLI call. No mid-conversation tool
 * roundtrips.
 */
import { Command } from "commander";
import { spawn } from "node:child_process";
import type { GlobalOptions } from "../../types.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";

interface ChannelLite {
  id: string;
  name: string;
}

function buildSystemPrompt(channels: ChannelLite[]): string {
  const channelList = channels
    .slice(0, 100)
    .map((c) => `- ${c.id} → #${c.name}`)
    .join("\n");
  return [
    "Help the user create an Ano automation — a server-side recurring job that runs 24/7 even when their laptop is closed.",
    "",
    "## Channels in this workspace",
    channelList || "  (none)",
    "",
    "## Tools",
    "You have ONE Bash tool action to take: save the final plan via",
    "  `echo '<plan-json>' | ano automation create-compiled`",
    "If `trigger_type=webhook`, follow with ONE more Bash action:",
    "  `ano automation webhook-setup <id-from-create-output>`",
    "",
    "**Do not call any other `ano` commands** — channel ids are above; the plan ships directly. No `ano channels list`, no `ano automation compile`, no `ano automation create`. They're all redundant given the context above.",
    "",
    "Do NOT use CC's `schedule` skill, `CronCreate`/`CronList`/`CronDelete`, `ScheduleWakeup` — those schedule inside *this* Shell and vanish.",
    "",
    "## Plan shape",
    "```json",
    "{",
    '  "name": "<short label, ≤80 chars>",',
    '  "trigger_type": "schedule" | "message_match" | "mention" | "channel_event" | "webhook",',
    '  "trigger_config": { /* schedule: {cron, tz}; message_match: {channel_id, pattern}; channel_event: {channel_id, event_type}; mention: {channel_ids?:[]}; webhook: {} */ },',
    '  "actions": [{ "tool": "send_message" | "send_dm" | "sql_query" | "http_request" | "run_skill", "args": { /* send_message: {channel_id, content}; send_dm: {user_id, content}; sql_query: {connection, query}; http_request: {method, url, body?}; run_skill: {skill_id, args} */ } }]',
    "}",
    "```",
    "",
    "Reference channels by id (the `ch_...` value above). Cron expressions use 5-field format (`0 9 * * 1-5`). Pick sensible defaults when vague (9 AM workspace time, etc.) and call them out in your confirmation.",
    "",
    "## Flow (2 turns + 1 save)",
    "1. **Ask once.** Open with: \"What do you want this automation to do? Describe it in one sentence (e.g. 'every weekday at 9am post hi to #general').\"",
    "2. **Build + confirm.** Parse my answer into a plan. Show it back to me in plain English (NOT JSON) — e.g. \"Got it: every weekday at 9am, post 'hi' to #general. Confirm?\" Wait for yes/no/tweak.",
    "3. **Save.** On confirm, run `echo '<plan-json>' | ano automation create-compiled`. If webhook, follow with `ano automation webhook-setup <id>`. Then tell me it's live and when it'll first fire.",
    '4. **Offer to test.** End with: "Want to test it? (dry-run / fire / skip)". Dry-run shows what would happen without firing actions; fire actually runs it once now. On dry-run, run `ano automation run <id>` (default is dry-run) and render the `would_execute` list in plain English. On fire, run `ano automation run <id> --no-dry-run` and render the resulting `steps` summary (success/error per step).',
    "",
    "If I want to tweak in step 2, apply the change and re-confirm. Don't ask additional questions unless something is genuinely missing (e.g. I said 'webhook' but didn't say what action). Stay short. No JSON in your messages until the final save command.",
  ].join("\n");
}

const KICKOFF =
  'What do you want this automation to do? Describe it in one sentence (e.g. "every weekday at 9am post hi to #general" or "DM me when someone reacts 🚨 to a message"). Just answer — no questions yet.';

export function registerNewAutomation(parent: Command): void {
  parent
    .command("automation [request...]")
    .description(
      'Create a new Ano automation, guided by Claude Code. Optionally pass a one-line description as the request (e.g. `ano new automation "every weekday at 9am post yesterday\'s signups to #growth"`).',
    )
    .action(
      async (request: string[] | undefined, _opts: unknown, cmd: Command) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const userIntent = (request ?? []).join(" ").trim();

        // Hard exit when stdin isn't a TTY. This command spawns a child
        // `claude` Code subprocess that walks the user through a multi-turn
        // spec build. From a non-TTY caller (typically Claude Code's own
        // Bash tool, or a CI shell) every invocation spawns a *fresh*
        // subprocess with no shared state — the user's "yes, confirmed"
        // hits a brand-new session. Print a hint pointing to the
        // build-before-talk path and bail rather than silently misbehave.
        if (!process.stdin.isTTY) {
          process.stderr.write(
            "ano new automation requires an interactive terminal — it spawns a multi-turn chat in Claude Code.\n\n" +
              "If you're running this from inside a Claude Code session (Bash tool), DON'T — each call spawns a fresh subprocess with no shared state, so the multi-turn flow breaks.\n\n" +
              "Use the build-before-talk path instead:\n" +
              "  1. Resolve any named users/channels (ano user_get_by_name, ano channels list)\n" +
              "  2. Compose the compiled plan offline\n" +
              "  3. Validate:  ano automation validate --file plan.json --agent\n" +
              "  4. Submit:    cat plan.json | ano automation create-compiled --file - --agent\n\n" +
              "Sub-100ms server latency, no nested-session state loss. See the ano-cli skill for the full plan shape.\n",
          );
          process.exit(2);
        }

        // Pre-fetch channels so CC has them in the system prompt and
        // never has to call `ano channels list` mid-conversation.
        // Failure here is non-fatal — fall through to an empty list and
        // CC will reference channels by name (the user can correct).
        let channels: ChannelLite[] = [];
        try {
          const auth = resolveAuth(globals);
          const client = createApiClient(auth);
          const r = await client.listChannels({
            workspace_id: globals.workspace,
          });
          channels = (r.channels ?? []).map((c) => ({
            id: String(c.id),
            name: String(c.name),
          }));
        } catch {
          /* non-fatal */
        }

        const systemPrompt = buildSystemPrompt(channels);
        // First user-prompt: either the kickoff (one-sentence ask) or
        // the user's pre-supplied intent (skip the kickoff and go
        // straight to confirmation).
        const userPrompt = userIntent
          ? `My request: ${userIntent}\n\nBuild the plan, show it back to me in plain English, and ask me to confirm.`
          : KICKOFF;

        const args = [
          "--model",
          "claude-haiku-4-5-20251001",
          "--effort",
          "low",
          "--disable-slash-commands",
          "--append-system-prompt",
          systemPrompt,
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
          process.stderr.write(
            `Failed to launch Claude Code: ${err.message}\n`,
          );
          process.exit(1);
        });
        child.on("exit", (code) => {
          process.exit(code ?? 0);
        });
      },
    );
}
