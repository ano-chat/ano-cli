import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { output } from "../../../core/output.js";

export function registerAuthStatus(parent: Command): void {
  parent
    .command("status")
    .description("Show current authentication status")
    .action(
      withErrorHandler(async (_opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        try {
          const auth = resolveAuth(globals);
          output(globals, {
            data: {
              authenticated: true,
              source: auth.source,
              endpoint: auth.endpoint,
              key_prefix: auth.key.slice(0, 12) + "...",
            },
            title: "Auth Status",
            breadcrumbs: [
              {
                action: "context",
                cmd: "ano doctor",
                description: "Run full diagnostics",
              },
            ],
          });
        } catch {
          output(globals, {
            data: { authenticated: false },
            title: "Auth Status",
            breadcrumbs: [
              {
                action: "login",
                cmd: "ano auth login --key <key>",
                description: "Authenticate with an API key",
              },
            ],
          });
        }
      }),
    );
}
