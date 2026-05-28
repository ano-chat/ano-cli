import { Command } from "commander";
import type { GlobalOptions } from "../types.js";
import { withErrorHandler } from "../middleware/error-handler.js";
import { resolveAuth } from "../../core/auth.js";
import { resolveWebAppUrl } from "../../core/web-url.js";

/**
 * `ano web-url` — print the web app base URL for the current
 * environment (e.g. https://app.ano.dev, http://localhost:1420). Used by
 * the unread-triage workflow to build "jump to message" deep-links
 * without hardcoding an origin. Server-authoritative (reads `webAppUrl`
 * from /api/min-version), derives from the endpoint on any failure.
 *
 * Prints the bare URL so scripts can consume it directly:
 *   BASE=$(ano web-url)
 */
export function registerWebUrl(parent: Command): void {
  parent
    .command("web-url")
    .description(
      "Print the web app base URL for the current environment (for building deep-links)",
    )
    .action(
      withErrorHandler(async (_opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const url = await resolveWebAppUrl(auth.endpoint);
        process.stdout.write(`${url}\n`);
      }),
    );
}
