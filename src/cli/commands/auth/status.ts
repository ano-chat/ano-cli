import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

export function registerAuthStatus(parent: Command): void {
  parent
    .command("status")
    .description("Show current authentication status")
    .option(
      "--verify",
      "Make a live API call to confirm the key is actually VALID (not just " +
        "present). Without this, status only reports that a key was found on " +
        "disk/env — an expired or revoked key still shows authenticated:true. " +
        "Costs one round-trip; sets exit code 3 if the key is invalid.",
    )
    .action(
      withErrorHandler(async (opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const verify = opts.verify === true;

        let auth;
        try {
          auth = resolveAuth(globals);
        } catch {
          // No key resolvable at all (none on disk/env/flag).
          output(globals, {
            data: { authenticated: false, key_present: false },
            title: "Auth Status",
            breadcrumbs: [
              {
                action: "login",
                cmd: "ano auth login --key <key>",
                description: "Authenticate with an API key",
              },
            ],
          });
          return;
        }

        // Key is PRESENT. Whether it's VALID is a separate question — only
        // answerable by hitting the server. Default stays offline + fast;
        // `--verify` does the live check.
        const base = {
          source: auth.source,
          endpoint: auth.endpoint,
          key_prefix: auth.key.slice(0, 12) + "...",
          // `workspace_name` comes from `credentials.json`, populated only
          // for profile-backed creds pinned via `ano workspaces use`.
          ...(auth.workspace_name
            ? { workspace_name: auth.workspace_name }
            : {}),
        };

        if (!verify) {
          output(globals, {
            data: {
              authenticated: true,
              key_present: true,
              // Explicit: presence ≠ validity. An expired key still lands
              // here. Use --verify to actually check.
              verified: false,
              ...base,
            },
            title: "Auth Status",
            breadcrumbs: [
              {
                action: "verify",
                cmd: "ano auth status --verify",
                description: "Confirm the key is actually valid (live check)",
              },
            ],
          });
          return;
        }

        // --verify: probe the server. `context()` requires a valid key, so a
        // success proves validity and an AuthError (code 3) proves it's
        // expired/revoked despite being present on disk.
        try {
          const ctx = await createApiClient(auth).context();
          output(globals, {
            data: {
              authenticated: true,
              key_present: true,
              key_valid: true,
              verified: true,
              ...base,
              user: { id: ctx.user.id, name: ctx.user.name },
              workspace: {
                id: ctx.workspace.id,
                name: ctx.workspace.name,
              },
            },
            title: "Auth Status",
          });
        } catch (err) {
          // Key present but the server rejected it (expired/revoked) — the
          // exact false-positive this flag exists to surface.
          output(globals, {
            data: {
              authenticated: false,
              key_present: true,
              key_valid: false,
              verified: true,
              ...base,
              error: (err as Error).message,
            },
            title: "Auth Status",
            breadcrumbs: [
              {
                action: "login",
                cmd: "ano auth login",
                description: "Re-authenticate (the stored key is invalid)",
              },
            ],
          });
          // Non-zero exit so scripts/agents can gate on key validity.
          process.exitCode = 3;
        }
      }),
    );
}
