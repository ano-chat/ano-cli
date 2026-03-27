/**
 * Generate or check the CLI surface snapshot.
 *
 * Usage:
 *   tsx snapshots/update-surface.ts          # Regenerate surface.json
 *   tsx snapshots/update-surface.ts --check  # Compare and fail on breaking changes
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createProgram } from "../src/cli/root.js";
import { registerAllCommands } from "../src/cli/register.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SURFACE_PATH = join(__dirname, "surface.json");

interface SurfaceEntry {
  command: string;
  flags: string[];
  args: string[];
}

function walkSurface(
  cmd: import("commander").Command,
  prefix: string[] = [],
): SurfaceEntry[] {
  const result: SurfaceEntry[] = [];
  const path = cmd.parent ? [...prefix, cmd.name()] : prefix;

  for (const sub of cmd.commands) {
    if (sub.name() === "help") continue;
    const hasChildren =
      sub.commands.filter((c) => c.name() !== "help").length > 0;
    if (hasChildren) {
      result.push(...walkSurface(sub, path));
    } else {
      result.push({
        command: [...path, sub.name()].join(" "),
        flags: sub.options
          .filter((o) => o.long !== "--help" && o.long !== "--version")
          .map((o) => o.long ?? o.short ?? "")
          .filter(Boolean)
          .sort(),
        args: sub.registeredArguments.map((a) => a.name()).filter(Boolean),
      });
    }
  }

  return result.sort((a, b) => a.command.localeCompare(b.command));
}

const program = createProgram();
registerAllCommands(program);
const surface = walkSurface(program);

const isCheck = process.argv.includes("--check");

if (isCheck) {
  if (!existsSync(SURFACE_PATH)) {
    console.error("No surface.json found. Run without --check first.");
    process.exit(1);
  }

  const existing = JSON.parse(
    readFileSync(SURFACE_PATH, "utf-8"),
  ) as SurfaceEntry[];
  const existingMap = new Map(existing.map((e) => [e.command, e]));
  const currentMap = new Map(surface.map((e) => [e.command, e]));

  let breaking = false;

  // Check for removed commands
  for (const cmd of existingMap.keys()) {
    if (!currentMap.has(cmd)) {
      console.error(`BREAKING: Command removed: ${cmd}`);
      breaking = true;
    }
  }

  // Check for removed flags
  for (const [cmd, entry] of existingMap) {
    const current = currentMap.get(cmd);
    if (!current) continue;
    for (const flag of entry.flags) {
      if (!current.flags.includes(flag)) {
        console.error(`BREAKING: Flag removed: ${cmd} ${flag}`);
        breaking = true;
      }
    }
  }

  // Report additions (non-breaking)
  for (const cmd of currentMap.keys()) {
    if (!existingMap.has(cmd)) {
      console.log(`Added: ${cmd}`);
    }
  }

  if (breaking) {
    console.error(
      "\nBreaking changes detected. Update surface.json with: npm run surface:update",
    );
    process.exit(1);
  }

  console.log("Surface check passed.");
} else {
  writeFileSync(SURFACE_PATH, JSON.stringify(surface, null, 2) + "\n");
  console.log(`Surface snapshot written: ${surface.length} commands`);
}
