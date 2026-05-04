import { Command } from "commander";

import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import {
  loadGlobalCredentials,
  saveGlobalCredentials,
} from "../../../core/config.js";
import { AnoCliError, NotFoundError } from "../../../core/errors.js";
import { ExitCode } from "../../types.js";

/**
 * `ano workspaces use <workspace-id>` — set the active workspace for the
 * current profile so subsequent commands don't need `--workspace-id`.
 *
 * Behaviour:
 *   - validates that the authenticated user is a member of the named
 *     workspace by calling `/mcp/list_workspaces`. Refuses to save if
 *     the user can't see it (avoids saving a typo'd or unauthorized id).
 *   - writes `workspace_id` + `workspace_name` onto the matching profile
 *     in `~/.config/ano/credentials.json`.
 *
 * Multi-workspace users: run this once per shell session change, or
 * pass `--workspace-id` per command. The saved value is profile-scoped,
 * so different profiles can target different workspaces.
 */
export function registerUseWorkspace(parent: Command): void {
  parent
    .command("use <workspace-id>")
    .description(
      "Set the active workspace for this profile. Subsequent commands default to it.",
    )
    .option("-p, --profile <name>", "Profile name", "default")
    .action(
      withErrorHandler(async (workspaceId: string, opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        const result = await client.listWorkspaces();
        const match = result.workspaces.find((w) => w.id === workspaceId);
        if (!match) {
          throw new NotFoundError(
            `You are not a member of workspace "${workspaceId}". Run \`ano workspaces list --agent\` to see what's available.`,
          );
        }

        const creds = loadGlobalCredentials();
        if (!creds || !creds.profiles[opts.profile]) {
          throw new AnoCliError(
            `No saved credentials for profile "${opts.profile}". Run \`ano auth login\` first.`,
            ExitCode.AUTH,
            'Run "ano auth login" first',
          );
        }

        creds.profiles[opts.profile] = {
          ...creds.profiles[opts.profile],
          workspace_id: match.id,
          workspace_name: match.name,
        };
        saveGlobalCredentials(creds);

        output(globals, {
          data: {
            profile: opts.profile,
            workspace_id: match.id,
            workspace_name: match.name,
          },
          columns: ["profile", "workspace_id", "workspace_name"],
          title: "Active workspace updated",
          breadcrumbs: [
            {
              action: "list_channels",
              cmd: "ano channels list",
              description: "List channels in the now-active workspace",
            },
          ],
        });
      }),
    );
}
