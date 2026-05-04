/**
 * `ano new automation` — print workspace context + build-before-talk
 * instructions, exit immediately.
 *
 * The runtime where this is invoked IS Claude Code (Ano desktop's Shell
 * is Claude Code; orchestrators are Claude Code; users running this in
 * a real terminal are inside `claude` too). There is no scenario where
 * we want to spawn a child claude — that wastes 28-30 seconds booting
 * a redundant nested session, multi-turn dies between Bash invocations
 * (state loss), and produces worse results than the parent CC working
 * on the build inline.
 *
 * Instead, this command:
 *   1. Pre-fetches workspace channels
 *   2. Prints a structured "here's everything you need to build the
 *      plan" payload — channel id→name map + plan-shape recap +
 *      build-before-talk recipe
 *   3. Exits in ~300ms
 *
 * The surrounding Claude Code reads the output (via Bash tool) and
 * follows the recipe: resolve refs → compose plan → validate →
 * confirm with the user → submit via `automation create-compiled`.
 *
 * No subprocess. No 30-second boot. No state loss.
 */
import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";

interface ChannelLite {
  id: string;
  name: string;
}

function renderInstructions(
  channels: ChannelLite[],
  workspaceId: string | undefined,
  userIntent: string,
): string {
  const channelTable = channels
    .slice(0, 100)
    .map((c) => `  ${c.id} → #${c.name}`)
    .join("\n");

  const kickoffOrIntent = userIntent
    ? `User intent (already given): "${userIntent}"\n\nSkip the kickoff question — go straight to step 2 (compose).`
    : `Step 1 — kickoff question to ask the user:\n  "What do you want this automation to do? Describe it in one sentence (e.g. 'every weekday at 9am post hi to #general')."`;

  return [
    "═══ Build a new Ano automation ═══════════════════════════════════════════",
    "",
    "You (the surrounding Claude Code session) are the agent. Build this",
    "automation directly using the build-before-talk recipe — DO NOT spawn",
    "a child claude, and DO NOT call `ano automation create` (the slow",
    "server-side LLM compile path).",
    "",
    `Workspace: ${workspaceId ?? "(default — ano workspaces use to set)"}`,
    "",
    "Channels in this workspace (use these ids in trigger_config + actions):",
    channelTable || "  (none)",
    "",
    kickoffOrIntent,
    "",
    "Step 2 — compose the compiled plan inline:",
    "",
    "  {",
    '    "name": "<short label, ≤80 chars>",',
    '    "trigger_type": "schedule" | "message_match" | "mention" | "channel_event" | "webhook",',
    '    "trigger_config": { /* schedule: {cron, tz}; message_match: {channel_id, pattern}; channel_event: {channel_id, event_type}; mention: {channel_ids?:[]}; webhook: {} */ },',
    '    "actions": [{ "tool": "send_message" | "send_dm" | "sql_query" | "http_request" | "run_skill", "args": { /* see SKILL.md action vocabulary */ } }],',
    '    "sender_kind": "bot" | "coworker" | "human",',
    '    "bot_avatar": "🤖"  // optional, only for sender_kind=bot',
    "  }",
    "",
    "  Cron is 5-field (`0 9 * * 1-5`). 24-hour times. Pick sensible defaults",
    "  when vague (9 AM Stockholm) and call them out in your confirmation.",
    "",
    "  If you need to resolve a named user, run:",
    "    ano user_get_by_name <Name> --agent",
    "    ano user_get_by_email <email> --agent",
    "",
    "Step 3 — validate offline (catches schema + lint issues):",
    "  echo '<plan-json>' | ano automation validate --file - --agent",
    "",
    "Step 4 — read the plan back to the user in plain English (NO JSON):",
    '  e.g. "Got it: every weekday at 9am Stockholm time, post a hello',
    '       message to #general. Confirm?"',
    "  Wait for yes/no/tweak. If tweak, apply + re-confirm.",
    "",
    "Step 5 — on confirm, save with one Bash call:",
    "  echo '<plan-json>' | ano automation create-compiled --file - --agent",
    "",
    "  If trigger_type=webhook, follow with:",
    "    ano automation webhook-setup <id-from-create-output> --agent",
    "",
    "Step 6 — tell the user it's live and offer a test:",
    '  "Created. First fire in 14h 22m (Tue, May 5, 09:00 Stockholm).',
    '  Want to test it now? (dry-run / fire-once / skip)"',
    "",
    "  Dry-run:  ano automation run <id> --agent              (default is dry-run)",
    "  Fire-once: ano automation run <id> --no-dry-run --agent",
    "",
    "Total elapsed: ~2 seconds end-to-end (no LLM round-trip on the server).",
    "═══════════════════════════════════════════════════════════════════════════",
  ].join("\n");
}

export function registerNewAutomation(parent: Command): void {
  parent
    .command("automation [request...]")
    .description(
      'Print workspace context + build-before-talk recipe for the surrounding Claude Code to build a new Ano automation. Optionally pass a one-line description as the request (e.g. `ano new automation "every weekday at 9am post yesterday\'s signups to #growth"`).',
    )
    .action(
      async (request: string[] | undefined, _opts: unknown, cmd: Command) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const userIntent = (request ?? []).join(" ").trim();

        // Pre-fetch channels so the surrounding CC has the id→name map
        // upfront and never needs a `list_channels` round-trip mid-build.
        // Failure here is non-fatal — fall through to an empty list and
        // the agent can call `ano channels list` itself if needed.
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

        process.stdout.write(
          renderInstructions(channels, globals.workspace, userIntent) + "\n",
        );
        // Exit 0 — this is informational, not an error path.
      },
    );
}
