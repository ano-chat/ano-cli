import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";
import { bold, cyan, dim } from "../../../util/colors.js";

/**
 * Wrap a URL as an OSC 8 hyperlink so terminals that support it
 * (iTerm2, modern Terminal.app, kitty, wezterm, VS Code) render the
 * label as clickable. Terminals that don't support OSC 8 ignore the
 * escapes and the URL still appears inline.
 */
function osc8(url: string, label: string): string {
  if (!process.stdout.isTTY || process.env.NO_COLOR) return `${label}\n${url}`;
  // OSC 8 ; params ; URI ST  label  OSC 8 ; ; ST
  return `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;
}

export function registerIntegrationsConnect(parent: Command): void {
  parent
    .command("connect <app>")
    .description(
      "Authorize a third-party service (Linear, GitHub, Gmail, Notion, HubSpot, PostHog, etc.) for use in automations. Prints a URL the user opens to OAuth in their browser; once they finish, the connection is persisted automatically and is usable by automation actions like `pipedream_run`.",
    )
    .action(
      withErrorHandler(async (app: string, _opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        const result = await client.requestConnection({
          app,
          workspace_id: globals.workspace,
        });

        // Machine-readable surfaces (--json, --md, --quiet, --agent) get
        // the full envelope through the standard output helper. The
        // styled (TTY) path prints a clickable hyperlink + a tip about
        // what to do next, since just dumping JSON to a human reader
        // would bury the URL.
        if (globals.json || globals.md || globals.quiet || globals.agent) {
          output(globals, { data: result, title: "Connect URL" });
          return;
        }

        const expiresAt = new Date(result.expires_at);
        const minutesLeft = Math.max(
          0,
          Math.round((expiresAt.getTime() - Date.now()) / 60_000),
        );

        process.stdout.write(`${bold(`Authorize ${app}`)}\n\n`);
        process.stdout.write(
          `  ${osc8(result.auth_url, cyan(result.auth_url))}\n\n`,
        );
        process.stdout.write(
          `${dim(`Opens Pipedream's hosted OAuth. URL is valid for ~${minutesLeft} minutes.`)}\n`,
        );
        process.stdout.write(`${dim(`Workspace: ${result.workspace_id}`)}\n`);
        process.stdout.write(
          `${dim(`After OAuth completes, the connection appears as ${result.expected_connection_name}.`)}\n`,
        );
      }),
    );
}
