import { Command } from "commander";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { green, dim } from "../../../util/colors.js";

export function registerSetupClaude(parent: Command): void {
  parent
    .command("claude")
    .description("Install Ano skill for Claude Code")
    .option("--global", "Install to ~/.claude/skills/ (global)")
    .action(async (opts) => {
      const skillSrc = findSkillFile();

      if (!skillSrc) {
        console.error(
          "Error: Could not find SKILL.md. Ensure ano-cli is installed correctly.",
        );
        process.exit(1);
      }

      const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";
      const dest = opts.global
        ? join(home, ".claude", "skills", "ano.md")
        : join(process.cwd(), ".claude", "skills", "ano.md");

      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(skillSrc, dest);

      console.log(`${green("Skill installed")} at ${dim(dest)}`);
      console.log(
        `Claude Code will now use \`ano\` commands for Ano interactions.`,
      );
    });
}

function findSkillFile(): string | null {
  // Strategy 1: Resolve from package root via require.resolve
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("ano-cli/package.json");
    const pkgRoot = dirname(pkgPath);
    const candidate = join(pkgRoot, "skills", "ano", "SKILL.md");
    if (existsSync(candidate)) return candidate;
  } catch {
    // Not installed as a package, try relative paths
  }

  // Strategy 2: Walk up from the entry script's directory
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "skills", "ano", "SKILL.md");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}
