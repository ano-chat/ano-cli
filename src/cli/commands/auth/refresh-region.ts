import { Command } from "commander";
import { withErrorHandler } from "../../middleware/error-handler.js";
import {
  loadGlobalCredentials,
  saveGlobalCredentials,
} from "../../../core/config.js";
import { AuthError } from "../../../core/errors.js";
import { resolveRoute } from "../../../core/region-resolver.js";
import { green, dim } from "../../../util/colors.js";

/**
 * `ano auth refresh-region [--profile <name>]`
 *
 * One-shot upgrade path for users who logged in before WS-B11. Re-runs
 * the Worker's `/route?workspace_id=<id>` lookup and rewrites the
 * profile's `endpoint` to the resolved regional URL. Idempotent —
 * running it after the profile is already pinned is a no-op.
 *
 * Resolves against `https://api.ano.dev` because that's where the
 * Worker is mounted; regional endpoints don't serve `/route`. We use
 * the apex regardless of whatever the profile currently points at —
 * the workspace_id is the source of truth for "what region does this
 * workspace live in?", not the configured endpoint.
 */
export function registerAuthRefreshRegion(parent: Command): void {
  parent
    .command("refresh-region")
    .description(
      "Re-resolve the regional API endpoint for a profile via the " +
        "Worker's /route lookup, and rewrite ~/.config/ano/credentials.json " +
        "if it changed.",
    )
    .option("-p, --profile <name>", "Profile name", "default")
    .action(
      withErrorHandler(async (opts) => {
        const creds = loadGlobalCredentials();
        const profile = creds?.profiles[opts.profile];
        if (!profile) {
          throw new AuthError(
            `profile "${opts.profile}" not found. Run \`ano auth login\` first.`,
          );
        }
        if (!profile.workspace_id) {
          throw new AuthError(
            `profile "${opts.profile}" has no workspace_id pinned. ` +
              "Run `ano workspaces use <id>` to select one, then retry.",
          );
        }

        const route = await resolveRoute({
          endpoint: "https://api.ano.dev",
          workspaceId: profile.workspace_id,
        });
        if (!route) {
          throw new AuthError(
            "Worker /route lookup failed. Check network and try again.",
          );
        }

        const previous = profile.endpoint ?? "https://api.ano.dev";
        const next =
          route.apiUrl === "https://api.ano.dev" ? undefined : route.apiUrl;

        if (previous === (next ?? "https://api.ano.dev")) {
          console.log(
            `${dim("Already pinned to")} ${route.region.toUpperCase()} ${dim(`(${previous}).`)}`,
          );
          return;
        }

        creds!.profiles[opts.profile] = { ...profile, endpoint: next };
        saveGlobalCredentials(creds!);

        console.log(
          `${green("Updated")} profile "${opts.profile}" → ${route.region.toUpperCase()} ` +
            `(${next ?? "https://api.ano.dev"}).`,
        );
      }),
    );
}
