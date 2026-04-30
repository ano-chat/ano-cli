import { Command } from "commander";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { loadSession, deleteSession } from "../../../core/oauth-session.js";
import { AuthError, NotFoundError } from "../../../core/errors.js";
import { green } from "../../../util/colors.js";
import { listWorkspaces, mintCliKey, saveProfile } from "./auth-helpers.js";

/**
 * `ano auth complete --workspace-id <id>`
 *
 * Finishes the install started by `ano auth login --print-workspaces`.
 * Reads the cached access token from ~/.config/ano/.session, verifies the
 * picked workspace is one the user belongs to, mints a CLI key, writes the
 * profile, then deletes the cached session.
 *
 * Designed for orchestrators that ran `--print-workspaces` and need to
 * commit a workspace pick without re-running OAuth.
 */
export function registerAuthComplete(parent: Command): void {
  parent
    .command("complete")
    .description(
      "Finish a login flow started by `auth login --print-workspaces` " +
        "by minting a key for the selected workspace.",
    )
    .requiredOption(
      "--workspace-id <id>",
      "ID of the workspace to mint the key for",
    )
    .option("-p, --profile <name>", "Profile name", "default")
    .action(
      withErrorHandler(async (opts) => {
        const session = loadSession();
        if (!session) {
          throw new AuthError(
            "no cached login session found (or it expired). " +
              "Run `ano auth login --print-workspaces` first, then `auth complete` " +
              "within 5 minutes.",
          );
        }

        const { accessToken, endpoint } = session;

        // Sanity check: the picked workspace must actually be in the user's
        // memberships. Cheaper to re-list than to surface a confusing 403
        // from /api/cli-keys later.
        const workspaces = await listWorkspaces({ endpoint, accessToken });
        const workspace = workspaces.find((w) => w.id === opts.workspaceId);
        if (!workspace) {
          throw new NotFoundError(
            `workspace ${opts.workspaceId} is not in this account's memberships.`,
          );
        }

        const apiKey = await mintCliKey({
          endpoint,
          accessToken,
          workspaceId: workspace.id,
        });

        saveProfile({
          profile: opts.profile,
          key: apiKey,
          endpoint,
          workspaceName: workspace.name,
        });

        // Single-shot: drop the cached token now that we've used it.
        deleteSession();

        // JSON line on stdout — orchestrators get a clean machine-parseable
        // success signal. Humans running this directly still get a clear
        // message because we wrap the JSON object on its own line.
        process.stdout.write(
          JSON.stringify({
            ok: true,
            profile: opts.profile,
            workspace: { id: workspace.id, name: workspace.name },
          }) + "\n",
        );
        console.log(
          `${green("Authenticated")} in ${workspace.name}. ` +
            `Profile "${opts.profile}" saved.`,
        );
      }),
    );
}
