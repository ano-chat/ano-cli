import { defineConfig } from "tsup";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "bridge-entry": "src/bridge-entry.ts",
  },
  format: ["esm"],
  target: "node18",
  clean: true,
  splitting: true,
  banner: { js: "#!/usr/bin/env node" },
  define: {
    __VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.0.0-dev"),
  },
  // Bundle the latest ano-cli SKILL.md into dist/ at build time. This way
  // a fresh `npm install -g @ano-chat/cli` always ships the skill content
  // matching the CLI version, even if `@ano-chat/skills` isn't hoisted
  // where `require.resolve` can find it. `ano setup claude` reads from
  // dist/ first, falling back to require.resolve, then repo-local.
  onSuccess: async () => {
    // Bundle source-of-truth precedence:
    //   1. SIBLING_SKILLS_PATH env var (release pipeline can pin this)
    //   2. ../ano-skills (dev: monorepo-adjacent checkout — always latest)
    //   3. node_modules/@ano-chat/skills (CI / fresh clone — published)
    // The runtime fallback chain in `setup/claude.ts:findSkillFile`
    // mirrors this so dev runs via `tsx` also pick up latest content.
    const candidates: string[] = [];
    if (process.env.SIBLING_SKILLS_PATH) {
      candidates.push(
        join(process.env.SIBLING_SKILLS_PATH, "skills", "ano-cli", "SKILL.md"),
      );
    }
    candidates.push(join("..", "ano-skills", "skills", "ano-cli", "SKILL.md"));
    try {
      const require = createRequire(import.meta.url);
      const pkgPath = require.resolve("@ano-chat/skills/package.json");
      candidates.push(join(dirname(pkgPath), "skills", "ano-cli", "SKILL.md"));
    } catch {
      // @ano-chat/skills not installed — sibling fallback may still hit
    }

    for (const skillSrc of candidates) {
      if (!existsSync(skillSrc)) continue;
      const dest = join("dist", "skills", "ano-cli", "SKILL.md");
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(skillSrc, dest);
      // eslint-disable-next-line no-console
      console.log(`[tsup] bundled SKILL.md from ${skillSrc} → ${dest}`);
      return;
    }
    // eslint-disable-next-line no-console
    console.warn(
      "[tsup] could not bundle SKILL.md — none of the candidate paths exist. " +
        "Set SIBLING_SKILLS_PATH or `npm install` to provide @ano-chat/skills.",
    );
  },
});
