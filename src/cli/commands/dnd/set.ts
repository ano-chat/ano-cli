import { Command } from "commander";

import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

interface DndSetOpts {
  off?: boolean;
  on?: boolean;
  window?: string;
  until?: string;
  clear?: boolean;
}

/**
 * `ano dnd set [--on | --off] [--window 22:00-07:00] [--until <iso>]`
 * — wraps manifest `dnd_set`. Each user controls their own DND row.
 *
 *   ano dnd set --on
 *   ano dnd set --on --window 22:00-07:00
 *   ano dnd set --on --until 2026-05-05T08:00:00Z
 *   ano dnd set --off
 *   ano dnd set --clear         # disable + clear window/until
 */
export function registerDndSet(parent: Command): void {
  parent
    .command("set")
    .description("Enable, disable, or schedule Do Not Disturb")
    .option("--on", "Enable DND")
    .option("--off", "Disable DND")
    .option(
      "--window <hh:mm-hh:mm>",
      "Recurring quiet window (start-end, 24h format)",
    )
    .option(
      "--until <iso>",
      "Auto-disable timestamp (ISO 8601, e.g. 2026-05-05T08:00:00Z)",
    )
    .option("--clear", "Disable DND and clear window + until")
    .action(
      withErrorHandler(async (opts: DndSetOpts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        if (!opts.on && !opts.off && !opts.clear) {
          throw new Error(
            "Provide one of: --on / --off / --clear (with optional --window / --until).",
          );
        }

        let start_time: string | undefined;
        let end_time: string | undefined;
        if (opts.window) {
          const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(opts.window);
          if (!m)
            throw new Error("--window must be 'HH:MM-HH:MM' (24h format)");
          start_time = m[1];
          end_time = m[2];
        }

        const enabled = opts.clear ? false : Boolean(opts.on);
        const until = opts.clear ? null : opts.until;

        const result = await client.dndSet({
          enabled,
          start_time: opts.clear ? undefined : start_time,
          end_time: opts.clear ? undefined : end_time,
          until,
        });

        output(globals, {
          data: result,
          title: enabled
            ? `DND on${result.start_time ? ` (${result.start_time}-${result.end_time})` : ""}${result.until ? ` until ${result.until}` : ""}`
            : "DND off",
        });
      }),
    );
}
