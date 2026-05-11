import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { createApiClient } from "../../../core/api-client.js";
import { runOAuthLogin } from "../../../core/oauth-flow.js";
import { saveSession } from "../../../core/oauth-session.js";
import { AnoCliError } from "../../../core/errors.js";
import { ExitCode } from "../../types.js";
import { bold, cyan, dim, green } from "../../../util/colors.js";
import {
  resolveRoute,
  shouldResolveRoute,
} from "../../../core/region-resolver.js";
import {
  listWorkspaces,
  mintCliKey,
  saveProfile,
  stripTrailingSlash,
  type WorkspaceRow,
} from "./auth-helpers.js";

const DEFAULT_CLIENT_IDS: Record<string, string> = {
  "https://api-staging.ano.dev": "client_01KG774HCH15HC3EN79E7A9BV4",
  "https://api.ano.dev": "client_01KG774HCH15HC3EN79E7A9BV4",
};

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
            throw new AnoCliError(
              "--print-workspaces is incompatible with --key / ANO_API_KEY (no OAuth flow runs in that mode).",
              ExitCode.USAGE,
            );
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
          throw new AnoCliError(
            `no WorkOS client ID configured for ${endpoint}. Pass --client-id or set ANO_WORKOS_CLIENT_ID.`,
            ExitCode.USAGE,
          );
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

        if (opts.printWorkspaces) {
          // The contract for orchestrators is "stdout is always one JSON
          // line; exit code 0 = success." So even with zero memberships
          // we emit `{"workspaces":[]}` and exit 0; the orchestrator
          // surfaces an empty-account message in its own UI. Sessions
          // are still cached so `auth complete` can be re-run if the
          // user joins a workspace within the 5-minute TTL.
          saveSession({
            accessToken: oauth.accessToken,
            endpoint,
            clientId,
            createdAt: Date.now(),
            userId: oauth.user?.id,
          });
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

        // Interactive flow only — orchestrator path handled above.
        if (workspaces.length === 0) {
          throw new AnoCliError(
            "signed in, but this account has no workspaces.",
            ExitCode.NOT_FOUND,
          );
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

        // Pin the profile to the workspace's home region when we're
        // signing in through the geo-router apex. The Worker resolves
        // `workspace_id` → authoritative region via KV; we save that
        // regional URL so every subsequent command reads it from disk
        // and skips the apex hop. Best-effort: on resolver failure
        // (network down, KV miss, etc.) we keep the apex endpoint —
        // the Worker still geo-routes correctly at runtime.
        const regionalEndpoint = shouldResolveRoute(endpoint)
          ? ((
              await resolveRoute({
                endpoint,
                workspaceId: workspace.id,
              })
            )?.apiUrl ?? endpoint)
          : endpoint;

        saveProfile({
          profile: opts.profile,
          key: apiKey,
          endpoint: regionalEndpoint,
          workspaceId: workspace.id,
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

  // Pre-validated-key path (the `-k <key>` shortcut): once we know the
  // workspace from /context, pin to its home region the same way the
  // OAuth path does.
  const regionalEndpoint = shouldResolveRoute(opts.endpoint)
    ? ((
        await resolveRoute({
          endpoint: opts.endpoint,
          workspaceId: ctx.workspace.id,
        })
      )?.apiUrl ?? opts.endpoint)
    : opts.endpoint;

  saveProfile({
    profile: opts.profile,
    key: opts.key,
    endpoint: regionalEndpoint,
    workspaceId: ctx.workspace.id,
    workspaceName: ctx.workspace.name,
  });

  console.log(
    `${green("Authenticated")} as ${ctx.user.name} in ${ctx.workspace.name}`,
  );
  console.log(
    `Profile "${opts.profile}" saved to ~/.config/ano/credentials.json`,
  );
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
