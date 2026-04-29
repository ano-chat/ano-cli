import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { withErrorHandler } from "../../middleware/error-handler.js";
import {
  saveGlobalCredentials,
  loadGlobalCredentials,
} from "../../../core/config.js";
import { createApiClient } from "../../../core/api-client.js";
import { runOAuthLogin } from "../../../core/oauth-flow.js";
import { saveSession } from "../../../core/oauth-session.js";
import { bold, cyan, dim, green } from "../../../util/colors.js";

const DEFAULT_CLIENT_IDS: Record<string, string> = {
  "https://api-staging.ano.dev": "client_01KG774HCH15HC3EN79E7A9BV4",
  "https://api.ano.dev": "client_01KG774HCH15HC3EN79E7A9BV4",
};

interface WorkspaceRow {
  id: string;
  name: string;
  logo_url?: string | null;
}

export function registerAuthLogin(parent: Command): void {
  parent
    .command("login")
    .description("Save an API key for authentication")
    .option("-p, --profile <name>", "Profile name", "default")
    .option(
      "--workspace-id <id>",
      "Skip workspace picker and use this workspace",
    )
    .option(
      "--client-id <id>",
      "WorkOS client ID for the OAuth flow (override default for endpoint)",
    )
    .option(
      "--port <n>",
      "Loopback port for the OAuth callback (must be allowlisted in WorkOS)",
      (v) => Number.parseInt(v, 10),
    )
    .option(
      "--print-workspaces",
      "Run OAuth, cache the access token to ~/.config/ano/.session, print " +
        "available workspaces as a single JSON line on stdout, and exit " +
        "without minting a key. Pair with `ano auth complete --workspace-id " +
        "<id>` to finish the install. Useful for non-TTY orchestrators that " +
        "want to render their own workspace picker (e.g. Claude Code).",
    )
    .action(
      withErrorHandler(async (opts, cmd) => {
        const globals = cmd.optsWithGlobals();
        const endpoint = globals.endpoint ?? "https://api.ano.dev";
        const key = globals.key ?? process.env.ANO_API_KEY;

        if (key) {
          if (opts.printWorkspaces) {
            console.error(
              "Error: --print-workspaces is incompatible with --key / ANO_API_KEY (no OAuth flow runs in that mode).",
            );
            process.exit(1);
          }
          await saveValidatedKey({
            key,
            endpoint,
            profile: opts.profile,
          });
          return;
        }

        const clientId =
          opts.clientId ??
          process.env.ANO_WORKOS_CLIENT_ID ??
          DEFAULT_CLIENT_IDS[stripTrailingSlash(endpoint)];
        if (!clientId) {
          console.error(
            `Error: no WorkOS client ID configured for ${endpoint}. Pass --client-id or set ANO_WORKOS_CLIENT_ID.`,
          );
          process.exit(1);
        }

        // For --print-workspaces we want stdout to be ONLY the JSON line so
        // orchestrators can JSON.parse it cleanly. Suppress all human-prose
        // logs in that mode (still surface errors to stderr).
        const log = opts.printWorkspaces ? () => {} : console.log;

        log(bold("Signing in to Ano..."));
        const oauth = await runOAuthLogin({
          endpoint,
          clientId,
          port: opts.port,
          onAuthorizeUrl: opts.printWorkspaces
            ? undefined
            : (url) => {
                console.log(
                  `${dim("If the browser doesn't open, visit:")}\n  ${cyan(url)}`,
                );
              },
        });

        const workspaces = await listWorkspaces({
          endpoint,
          accessToken: oauth.accessToken,
        });
        if (workspaces.length === 0) {
          console.error(
            "Error: signed in, but this account has no workspaces.",
          );
          process.exit(1);
        }

        if (opts.printWorkspaces) {
          // Cache the token so `auth complete` can mint without re-running
          // OAuth. 5-minute TTL, mode 0o600.
          saveSession({
            accessToken: oauth.accessToken,
            endpoint,
            clientId,
            createdAt: Date.now(),
            userId: oauth.user?.id,
          });
          // Single JSON line on stdout — easiest to parse for orchestrators.
          process.stdout.write(
            JSON.stringify({
              workspaces: workspaces.map((w) => ({
                id: w.id,
                name: w.name,
                logo_url: w.logo_url ?? null,
              })),
            }) + "\n",
          );
          return;
        }

        const workspace = await pickWorkspace({
          workspaces,
          requestedId: opts.workspaceId,
        });

        const apiKey = await mintCliKey({
          endpoint,
          accessToken: oauth.accessToken,
          workspaceId: workspace.id,
        });

        saveProfile({
          profile: opts.profile,
          key: apiKey,
          endpoint,
          workspaceName: workspace.name,
        });

        const displayName = oauth.user
          ? [oauth.user.first_name, oauth.user.last_name]
              .filter(Boolean)
              .join(" ") || oauth.user.email
          : undefined;
        console.log(
          `${green("Authenticated")}${displayName ? ` as ${displayName}` : ""} in ${workspace.name}`,
        );
        console.log(
          `Profile "${opts.profile}" saved to ~/.config/ano/credentials.json`,
        );
      }),
    );
}

async function saveValidatedKey(opts: {
  key: string;
  endpoint: string;
  profile: string;
}): Promise<void> {
  const client = createApiClient({
    key: opts.key,
    endpoint: opts.endpoint,
    source: "flag",
  });
  const ctx = await client.context();

  saveProfile({
    profile: opts.profile,
    key: opts.key,
    endpoint: opts.endpoint,
    workspaceName: ctx.workspace.name,
  });

  console.log(
    `${green("Authenticated")} as ${ctx.user.name} in ${ctx.workspace.name}`,
  );
  console.log(
    `Profile "${opts.profile}" saved to ~/.config/ano/credentials.json`,
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

async function pickWorkspace(opts: {
  workspaces: WorkspaceRow[];
  requestedId?: string;
}): Promise<WorkspaceRow> {
  if (opts.requestedId) {
    const match = opts.workspaces.find((w) => w.id === opts.requestedId);
    if (!match) {
      throw new Error(
        `Workspace ${opts.requestedId} not found among your memberships.`,
      );
    }
    return match;
  }

  if (opts.workspaces.length === 1) {
    return opts.workspaces[0]!;
  }

  if (!process.stdin.isTTY) {
    const names = opts.workspaces.map((w) => `${w.id}  ${w.name}`).join("\n  ");
    throw new Error(
      `Multiple workspaces found. Re-run with --workspace-id <id>:\n  ${names}`,
    );
  }

  console.log(bold("\nPick a workspace:"));
  opts.workspaces.forEach((w, i) => {
    console.log(`  ${dim(`${i + 1}.`)} ${w.name}`);
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = (await rl.question("Number: ")).trim();
      const idx = Number.parseInt(answer, 10) - 1;
      if (Number.isInteger(idx) && idx >= 0 && idx < opts.workspaces.length) {
        return opts.workspaces[idx]!;
      }
      console.log(
        dim(`Please enter a number between 1 and ${opts.workspaces.length}.`),
      );
    }
  } finally {
    rl.close();
  }
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
    // Omit the endpoint for the default (prod) host so the profile stays
    // endpoint-agnostic and picks up any future default changes.
    endpoint: normalized === "https://api.ano.dev" ? undefined : normalized,
    workspace_name: opts.workspaceName,
    created_at: new Date().toISOString(),
  };
  saveGlobalCredentials(creds);
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
