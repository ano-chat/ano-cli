import { Command } from "commander";
import type { GlobalOptions, CommandMeta, FlagMeta } from "../types.js";

declare const __VERSION__: string;

export function registerCommands(parent: Command): void {
  parent
    .command("commands")
    .description("List all available commands")
    .action((_opts, cmd) => {
      const globals = cmd.optsWithGlobals() as GlobalOptions;
      const root = cmd.parent!;
      const catalog = walkCommands(root);

      if (globals.json || globals.agent || globals.quiet) {
        const version =
          typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev";
        process.stdout.write(
          JSON.stringify({ version, commands: catalog }, null, 2) + "\n",
        );
      } else {
        for (const c of catalog) {
          console.log(`  ${c.command.padEnd(35)} ${c.description}`);
        }
      }
    });
}

function walkCommands(
  cmd: Command,
  prefix: string[] = [],
): CommandMeta[] {
  const result: CommandMeta[] = [];
  const path = cmd.parent ? [...prefix, cmd.name()] : prefix;

  for (const sub of cmd.commands) {
    const subPath = [...path, sub.name()];
    if (sub.commands.length > 0) {
      result.push(...walkCommands(sub, path));
    } else {
      result.push({
        command: subPath.join(" "),
        path: subPath,
        description: sub.description(),
        args: sub.registeredArguments.map((a) => ({
          name: a.name(),
          description: a.description,
          required: a.required,
        })),
        flags: sub.options.map(
          (o): FlagMeta => ({
            name:
              o.long?.replace(/^--/, "") ??
              o.short?.replace(/^-/, "") ??
              "",
            short: o.short?.replace(/^-/, ""),
            description: o.description,
            required: o.required,
            type: o.flags.includes("<") ? "string" : "boolean",
            default: o.defaultValue,
          }),
        ),
        subcommands: [],
      });
    }
  }

  return result;
}
