import { Command } from "commander";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { loadSession, deleteSession } from "../../../core/oauth-session.js";
import { AuthError, NotFoundError } from "../../../core/errors.js";
import { green } from "../../../util/colors.js";
import {
  resolveRoute,
  shouldResolveRoute,
} from "../../../core/region-resolver.js";
import {
  listWorkspaces,
  listWorkspacesGlobal,
  mintCliKey,
  regionalApiUrl,
  saveProfile,
  type Region,
  type WorkspaceRow,
} from "./auth-helpers.js";

/**
 * Same fallthrough chain as login.ts: try `/cp/workspaces` first
 * (cross-region D1 list); on 404 fall back to the regional
 * `/api/cli-keys/workspaces`. Without this, the orchestrator path
 * (`ano auth complete --workspace-id <foreign>`) would 404 on the
 * sanity-check before it ever tries to mint.
 */
async function listWorkspacesForComplete(opts: {
  endpoint: string;
  accessToken: string;
}): Promise<WorkspaceRow[]> {
  const global = await listWorkspacesGlobal(opts);
  if (global !== null) return global;
  return await listWorkspaces(opts);
}

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
        const workspaces = await listWorkspacesForComplete({
          endpoint,
          accessToken,
        });
        const workspace = workspaces.find((w) => w.id === opts.workspaceId);
        if (!workspace) {
          throw new NotFoundError(
            `workspace ${opts.workspaceId} is not in this account's memberships.`,
          );
        }

        // Resolve region BEFORE minting — api_keys are FK'd to the
        // regional `workspaces(id)`, so cross-region mints at the
        // apex fail the FK check. See login.ts for the full rationale,
        // including the apex-only guard: `regionalApiUrl()` maps to
        // production hosts, so a staging session must stay on staging.
        const onApex = shouldResolveRoute(endpoint);
        const resolvedRegion: Region | null = onApex
          ? (workspace.region ??
            (
              await resolveRoute({
                endpoint,
                workspaceId: workspace.id,
              })
            )?.region ??
            null)
          : null;
        const regionalEndpoint =
          onApex && resolvedRegion ? regionalApiUrl(resolvedRegion) : endpoint;

        const apiKey = await mintCliKey({
          endpoint: regionalEndpoint,
          accessToken,
          workspaceId: workspace.id,
        });

        // Drop the cached token in a finally so the session is single-shot
        // even if saveProfile throws (disk full, permissions, etc.). If we
        // didn't, the next `auth complete` would re-load the stale session
        // and re-mint, wasting an HTTP call and triggering the server's
        // auto-revoke against the key we just minted.
        try {
          saveProfile({
            profile: opts.profile,
            key: apiKey,
            endpoint: regionalEndpoint,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            // Save region even off-apex (informational). Routing is
            // driven by `endpoint` either way.
            region: resolvedRegion ?? workspace.region ?? undefined,
          });
        } finally {
          deleteSession();
        }

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
