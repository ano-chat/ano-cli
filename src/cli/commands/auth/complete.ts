import { Command } from "commander";
import { withErrorHandler } from "../../middleware/error-handler.js";
import {
  saveGlobalCredentials,
  loadGlobalCredentials,
} from "../../../core/config.js";
import { loadSession, deleteSession } from "../../../core/oauth-session.js";
import { green } from "../../../util/colors.js";

interface WorkspaceRow {
  id: string;
  name: string;
  logo_url?: string | null;
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
          console.error(
            "Error: no cached login session found (or it expired). " +
              "Run `ano auth login --print-workspaces` first, then `auth complete` " +
              "within 5 minutes.",
          );
          process.exit(3); // AUTH
        }

        const { accessToken, endpoint } = session;

        // Sanity check: the picked workspace must actually be in the user's
        // memberships. Cheaper to re-list than to surface a confusing 403
        // from /api/cli-keys later.
        const workspaces = await listWorkspaces({ endpoint, accessToken });
        const workspace = workspaces.find((w) => w.id === opts.workspaceId);
        if (!workspace) {
          console.error(
            `Error: workspace ${opts.workspaceId} is not in this account's memberships.`,
          );
          process.exit(2); // NOT_FOUND
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

async function listWorkspaces(opts: {
  endpoint: string;
  accessToken: string;
}): Promise<WorkspaceRow[]> {
  const res = await fetch(
    `${stripTrailingSlash(opts.endpoint)}/api/cli-keys/workspaces`,
    {
      headers: { Authorization: `Bearer ${opts.accessToken}` },
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to list workspaces: ${res.status}${text ? ` ${text}` : ""}`,
    );
  }
  const body = (await res.json()) as { workspaces?: WorkspaceRow[] };
  return body.workspaces ?? [];
}

async function mintCliKey(opts: {
  endpoint: string;
  accessToken: string;
  workspaceId: string;
}): Promise<string> {
  const res = await fetch(`${stripTrailingSlash(opts.endpoint)}/api/cli-keys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspace_id: opts.workspaceId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to mint CLI key: ${res.status}${text ? ` ${text}` : ""}`,
    );
  }
  const body = (await res.json()) as { api_key?: string };
  if (!body.api_key) {
    throw new Error("CLI key response was missing api_key");
  }
  return body.api_key;
}

function saveProfile(opts: {
  profile: string;
  key: string;
  endpoint: string;
  workspaceName: string;
}): void {
  const creds = loadGlobalCredentials() ?? { profiles: {} };
  const normalized = stripTrailingSlash(opts.endpoint);
  creds.profiles[opts.profile] = {
    key: opts.key,
    endpoint: normalized === "https://api.ano.dev" ? undefined : normalized,
    workspace_name: opts.workspaceName,
    created_at: new Date().toISOString(),
  };
  saveGlobalCredentials(creds);
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
