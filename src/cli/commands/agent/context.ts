import type { Command } from "commander";
import type { GlobalOptions, Breadcrumb } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import {
  createApiClient,
  type Channel,
  type ContextResponse,
  type Table,
  type User,
} from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import { activeZeroOrNull } from "../../../zero/active-client.js";
import { listChannelsViaZero, listUsersViaZero } from "../../../zero/reads.js";

type Source = "zero" | "context_rest" | "rest" | "skipped";

interface AgentContextData {
  workspace_id: string | null;
  context: ContextResponse;
  channels: Channel[];
  users: User[];
  tables: Table[];
  sources: {
    context: Source;
    channels: Source;
    users: Source;
    tables: Source;
  };
  fast_path: {
    zero_available: boolean;
    daemon_recommended: boolean;
  };
}

export function registerAgentContext(parent: Command): void {
  parent
    .command("context")
    .description("Fetch common agent startup context in one command")
    .option("--no-tables", "Skip table listing")
    .action(
      withErrorHandler(async (opts: { tables?: boolean }, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const workspace_id = globals.workspace ?? auth.workspace_id;
        const includeTables = opts.tables !== false;

        const contextPromise = client.context({ workspace_id });
        const channelsPromise = workspace_id
          ? listChannelsViaZero({ workspace_id })
          : Promise.resolve(null);
        const usersPromise = workspace_id
          ? listUsersViaZero({ workspace_id })
          : Promise.resolve(null);
        const tablesPromise = includeTables
          ? client.listTables({ workspace_id })
          : Promise.resolve([] as Table[]);

        const [context, zeroChannels, zeroUsers, tables] = await Promise.all([
          contextPromise,
          channelsPromise,
          usersPromise,
          tablesPromise,
        ]);

        const data: AgentContextData = {
          workspace_id: workspace_id ?? context.workspace.id ?? null,
          context,
          channels: zeroChannels?.channels ?? context.channels,
          users: zeroUsers?.users ?? context.members,
          tables,
          sources: {
            context: "rest",
            channels: zeroChannels ? "zero" : "context_rest",
            users: zeroUsers ? "zero" : "context_rest",
            tables: includeTables ? "rest" : "skipped",
          },
          fast_path: {
            zero_available: activeZeroOrNull() !== null,
            daemon_recommended: true,
          },
        };

        output(globals, {
          data,
          breadcrumbs: buildBreadcrumbs(data),
          title: "Agent context",
        });
      }),
    );
}

function buildBreadcrumbs(data: AgentContextData): Breadcrumb[] {
  const workspaceFlag = data.workspace_id ? ` -w ${data.workspace_id}` : "";
  const firstChannel = data.channels[0]?.id;
  const firstTable = data.tables[0]?.id;

  return [
    ...(firstChannel
      ? [
          {
            action: "read_messages",
            cmd: `ano messages read --channel ${firstChannel} --limit 25${workspaceFlag}`,
            description: "Read recent messages from a known channel",
          },
        ]
      : []),
    {
      action: "list_channels",
      cmd: `ano channels list --json${workspaceFlag}`,
      description: "Refresh channels only",
    },
    {
      action: "list_users",
      cmd: `ano users list --json${workspaceFlag}`,
      description: "Refresh workspace members only",
    },
    ...(firstTable
      ? [
          {
            action: "get_table",
            cmd: `ano tables get ${firstTable} --json${workspaceFlag}`,
            description: "Fetch a table schema before writing items",
          },
        ]
      : []),
  ];
}
