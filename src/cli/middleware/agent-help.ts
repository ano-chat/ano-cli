import { Command } from "commander";
import type {
  CommandMeta,
  FlagMeta,
  ArgMeta,
  SubcommandMeta,
} from "../types.js";

/**
 * Handle --help --agent by finding the target command in the tree
 * and outputting structured JSON. Called before commander.parse().
 */
export function handleAgentHelp(program: Command): void {
  // Remove --help and --agent from argv to find the target command path
  const args = process.argv
    .slice(2)
    .filter((a) => a !== "--help" && a !== "--agent" && a !== "-h");

  // Walk the command tree to find the target
  let cmd: Command = program;
  for (const arg of args) {
    const sub = cmd.commands.find(
      (c) => c.name() === arg || c.aliases().includes(arg),
    );
    if (!sub) break;
    cmd = sub;
  }

  process.stdout.write(
    JSON.stringify(extractCommandMeta(cmd), null, 2) + "\n",
  );
  process.exit(0);
}

function extractCommandMeta(cmd: Command): CommandMeta {
  const path = getCommandPath(cmd);

  return {
    command: path.join(" "),
    path,
    description: cmd.description(),
    args: cmd.registeredArguments.map(
      (a): ArgMeta => ({
        name: a.name(),
        description: a.description,
        required: a.required,
      }),
    ),
    flags: cmd.options
      .filter((o) => o.long !== "--help" && o.long !== "--version")
      .map(
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
          env: o.envVar,
        }),
      ),
    subcommands: cmd.commands
      .filter((c) => c.name() !== "help")
      .map(
        (c): SubcommandMeta => ({
          name: c.name(),
          description: c.description(),
          path: [...path, c.name()].join(" "),
        }),
      ),
  };
}

function getCommandPath(cmd: Command): string[] {
  const parts: string[] = [];
  let current: Command | null = cmd;
  while (current) {
    if (current.name()) parts.unshift(current.name());
    current = current.parent;
  }
  return parts;
}
