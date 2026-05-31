import type { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { output } from "../../../core/output.js";

const routes = [
  {
    task: "read_channel_messages",
    budget: 1,
    command: "messages read <channel-name> --limit <n> --agent",
    fallback: "messages read --channel <channel-id> --limit <n> --agent",
  },
  {
    task: "send_channel_message",
    budget: 1,
    command: 'messages send "<text>" --channel-name <channel-name> --agent',
    fallback: 'messages send "<text>" --channel <channel-id> --agent',
  },
  {
    task: "startup_context",
    budget: 1,
    command: "agent context --no-tables --json",
    note: "Use once when broad workspace context is actually needed.",
  },
  {
    task: "search_messages",
    budget: 1,
    command: 'messages search "<query>" --limit <n> --agent',
    note: "Uses warm Zero when available, then falls back to REST before cold materialization is noticeable.",
  },
  {
    task: "send_dm",
    budget: 1,
    command: 'dm send "<text>" --to "<display-name>" --agent',
  },
] as const;

export function registerAgentRoutes(parent: Command): void {
  parent
    .command("routes")
    .description("Print fastest agent command routes")
    .action(
      withErrorHandler(async (_opts, cmd) => {
        output(cmd.optsWithGlobals() as GlobalOptions, {
          data: {
            transport: "Prefer `ano agent stdio` for multi-call tasks.",
            routes,
          },
          title: "Agent routes",
        });
      }),
    );
}
