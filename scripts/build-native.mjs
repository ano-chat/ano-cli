#!/usr/bin/env node
/**
 * Compile the CLI to standalone native binaries via `bun build --compile`.
 *
 * Why this exists alongside the tsup ESM build:
 *
 *   • The tsup ESM bundle still ships via npm (the existing distribution
 *     channel; runs on Node 20+). Most users get the CLI that way.
 *   • Native binaries shave the Node startup floor (~90 ms cold-start)
 *     down to ~20 ms — measurable on every CLI call, decisive when an
 *     agent loops through many commands. Distributed via GitHub
 *     Releases + Homebrew + curl-install (added in follow-up PR).
 *
 * Targets (Bun's cross-compile syntax; one host builds all four):
 *   • bun-darwin-arm64  → ano-darwin-arm64
 *   • bun-darwin-x64    → ano-darwin-x64
 *   • bun-linux-x64     → ano-linux-x64
 *   • bun-linux-arm64   → ano-linux-arm64
 *
 * Windows is omitted on purpose — Bun's Unix-socket support there is
 * incomplete and the daemon path is already disabled on win32 by the
 * client's `shouldBypass` rule. A native windows binary without the
 * daemon would actively regress performance vs. the npm install.
 *
 * Output goes to `dist-native/<filename>` plus a SHA256SUMS file. The
 * release workflow uploads these as release assets.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = join(ROOT, "dist-native");

const TARGETS = [
  { target: "bun-darwin-arm64", filename: "ano-darwin-arm64" },
  { target: "bun-darwin-x64", filename: "ano-darwin-x64" },
  { target: "bun-linux-x64", filename: "ano-linux-x64" },
  { target: "bun-linux-arm64", filename: "ano-linux-arm64" },
];

function getVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  return pkg.version;
}

function which(cmd) {
  try {
    return execFileSync("which", [cmd], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function sha256(filePath) {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

function fmtSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const bun = which("bun");
if (!bun) {
  console.error(
    "ERR: `bun` not found on PATH.\n" +
      "Install via `curl -fsSL https://bun.sh/install | bash` or use the\n" +
      "official setup-bun action in CI: https://github.com/oven-sh/setup-bun",
  );
  process.exit(1);
}

const version = getVersion();
console.log(`Building native binaries for @ano-chat/cli@${version}`);
console.log(`Using ${bun} (${execFileSync(bun, ["--version"], { encoding: "utf8" }).trim()})\n`);

mkdirSync(OUT, { recursive: true });

const entry = join(ROOT, "src", "index.ts");
const results = [];

for (const { target, filename } of TARGETS) {
  const outfile = join(OUT, filename);
  const t0 = Date.now();
  try {
    execFileSync(
      bun,
      [
        "build",
        "--compile",
        `--target=${target}`,
        `--define`,
        `__VERSION__="${version}"`,
        entry,
        "--outfile",
        outfile,
      ],
      { stdio: "inherit", cwd: ROOT },
    );
  } catch (err) {
    console.error(`\nFAIL: ${target} (${err.message})`);
    process.exit(1);
  }
  const elapsed = Date.now() - t0;
  const size = statSync(outfile).size;
  const hash = sha256(outfile);
  results.push({ filename, target, elapsed, size, hash });
  console.log(`  ✓ ${filename}  (${fmtSize(size)}, ${elapsed}ms)`);
}

// Emit SHA256SUMS in the canonical format (`<hash>  <filename>`), one
// per line. Released alongside the binaries so users can verify their
// download.
const sumsPath = join(OUT, "SHA256SUMS");
const sumsBody = results.map((r) => `${r.hash}  ${r.filename}`).join("\n") + "\n";
writeFileSync(sumsPath, sumsBody);
console.log(`  ✓ SHA256SUMS\n`);

console.log("Done. Artifacts in dist-native/:");
for (const r of results) {
  console.log(`  ${r.filename.padEnd(24)} ${fmtSize(r.size).padStart(8)}  sha256:${r.hash.slice(0, 12)}…`);
}
