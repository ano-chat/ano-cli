import { Command } from "commander";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { green, dim } from "../../../util/colors.js";

export function registerSetupClaude(parent: Command): void {
  parent
    .command("claude")
    .description("Install Ano skill for Claude Code")
    .option("--global", "Install to ~/.claude/skills/ (global)")
    .action(async (opts) => {
      const __dirname = dirname(fileURLToPath(import.meta.url));
      // Skill source is at skills/ano/SKILL.md relative to package root
      // In built dist, we need to find it relative to the package
      const skillSrc = findSkillFile(__dirname);

      if (!skillSrc) {
        console.error(
          "Error: Could not find SKILL.md. Ensure ano-cli is installed correctly.",
        );
        process.exit(1);
      }

      const dest = opts.global
        ? join(
            process.env.HOME ?? "~",
            ".claude",
            "skills",
            "ano.md",
          )
        : join(process.cwd(), ".claude", "skills", "ano.md");

      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(skillSrc, dest);

      console.log(`${green("Skill installed")} at ${dim(dest)}`);
      console.log(
        `Claude Code will now use \`ano\` commands for Ano interactions.`,
      );
    });
}

function findSkillFile(from: string): string | null {
  // Walk up from current dir to find skills/ano/SKILL.md
  let dir = from;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "skills", "ano", "SKILL.md");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return null;
}
