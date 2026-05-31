import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSetup } from "../../src/cli/commands/setup/index.js";

let tempDir: string;
let homeDir: string;
let originalCwd: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let originalCodexHome: string | undefined;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerSetup(program);
  return program;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ano-setup-skills-"));
  homeDir = join(tempDir, "home");
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  originalCodexHome = process.env.CODEX_HOME;

  process.chdir(tempDir);
  process.env.HOME = homeDir;
  delete process.env.USERPROFILE;
  delete process.env.CODEX_HOME;
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalCodexHome;
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("setup skills", () => {
  it("preserves the existing Claude skill install path", async () => {
    await buildProgram().parseAsync(["node", "ano", "setup", "claude"]);

    const dest = join(tempDir, ".claude", "skills", "ano.md");
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf8")).toContain("Fastest Agent Policy");
  });

  it("installs the Codex skill in directory-style layout", async () => {
    await buildProgram().parseAsync(["node", "ano", "setup", "codex"]);

    const dest = join(tempDir, ".codex", "skills", "ano-cli", "SKILL.md");
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf8")).toContain("Fastest Agent Policy");
  });

  it("honors CODEX_HOME for global Codex installs", async () => {
    const codexHome = join(tempDir, "custom-codex-home");
    process.env.CODEX_HOME = codexHome;

    await buildProgram().parseAsync([
      "node",
      "ano",
      "setup",
      "codex",
      "--global",
    ]);

    const dest = join(codexHome, "skills", "ano-cli", "SKILL.md");
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf8")).toContain("Fastest Agent Policy");
  });
});
