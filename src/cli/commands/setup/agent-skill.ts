import { Command } from "commander";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { green, dim } from "../../../util/colors.js";

type SkillTarget = "claude" | "codex";

const TARGETS: Record<
  SkillTarget,
  { label: string; description: string; globalHelp: string }
> = {
  claude: {
    label: "Claude Code",
    description: "Install Ano skill for Claude Code",
    globalHelp: "Install to ~/.claude/skills/ (global)",
  },
  codex: {
    label: "Codex",
    description: "Install Ano skill for Codex",
    globalHelp: "Install to $CODEX_HOME/skills/ or ~/.codex/skills/ (global)",
  },
};

export function registerSetupAgentSkill(
  parent: Command,
  target: SkillTarget,
): void {
  const meta = TARGETS[target];
  parent
    .command(target)
    .description(meta.description)
    .option("--global", meta.globalHelp)
    .action((opts: { global?: boolean }) => {
      installSkill(target, opts.global === true);
    });
}

function installSkill(target: SkillTarget, global: boolean): void {
  const skillSrc = findSkillFile();
  if (!skillSrc) {
    process.stderr.write(
      "Error: Could not find SKILL.md. Install @ano-chat/skills or rebuild the CLI.\n",
    );
    process.exit(1);
  }

  const dest = skillDestination(target, global);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(skillSrc, dest);

  process.stdout.write(`${green("Skill installed")} at ${dim(dest)}\n`);
  process.stdout.write(
    `${TARGETS[target].label} will now use the stdio-first Ano skill when available.\n`,
  );
}

function skillDestination(target: SkillTarget, global: boolean): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";
  if (target === "claude") {
    // Preserve the existing Claude setup path for compatibility.
    const root = global
      ? join(home, ".claude")
      : join(process.cwd(), ".claude");
    return join(root, "skills", "ano.md");
  }

  const codexHome = process.env.CODEX_HOME ?? join(home, ".codex");
  const root = global ? codexHome : join(process.cwd(), ".codex");
  return join(root, "skills", "ano-cli", "SKILL.md");
}

function findSkillFile(): string | null {
  const moduleDir = dirname(fileURLToPath(import.meta.url));

  const bundled = join(moduleDir, "skills", "ano-cli", "SKILL.md");
  if (existsSync(bundled)) return bundled;

  if (process.env.SIBLING_SKILLS_PATH) {
    const candidate = join(
      process.env.SIBLING_SKILLS_PATH,
      "skills",
      "ano-cli",
      "SKILL.md",
    );
    if (existsSync(candidate)) return candidate;
  }

  const repoRelPath = join(
    "packages",
    "skills",
    "skills",
    "ano-cli",
    "SKILL.md",
  );
  let dir = moduleDir;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, repoRelPath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("@ano-chat/skills/package.json");
    const candidate = join(dirname(pkgPath), "skills", "ano-cli", "SKILL.md");
    if (existsSync(candidate)) return candidate;
  } catch {
    // no fallback left
  }

  return null;
}
