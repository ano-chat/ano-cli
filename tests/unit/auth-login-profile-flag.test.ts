// Regression test for the bug fixed in v2.25.4:
//
//   `ano auth login --profile foo` would print "Profile 'default' saved"
//   and write the new credentials to `profiles.default`, OVERWRITING any
//   existing default profile. Root cause: `--profile` is declared on BOTH
//   the root command (`src/cli/root.ts:28`, env-bound to ANO_PROFILE) AND
//   on the `auth login` subcommand (with a default of "default"). Commander
//   routes the user-supplied value into `globals.profile`; the subcommand's
//   local `opts.profile` keeps its default. Pre-fix the action body read
//   `opts.profile`, missing the user's intent.
//
// The fix in v2.25.4 prefers `globals.profile` over `opts.profile`.
// This test mirrors the PRODUCTION command tree (root --profile AND
// subcommand --profile) — without that fidelity, the bug wouldn't repro
// (existing test fixtures register the subcommand without the root flag).
//
// We don't actually run the OAuth flow — the --key shortcut path
// (`ano auth login --key <key>`) takes the same `--profile` decision and
// is easier to mock.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command, Option } from "commander";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../../src/core/config.js", () => ({
  loadGlobalCredentials: vi.fn(() => null),
  saveGlobalCredentials: vi.fn(),
  loadProjectConfig: vi.fn(),
}));
vi.mock("../../src/core/api-client.js", () => ({
  createApiClient: vi.fn(() => ({
    context: vi.fn().mockResolvedValue({
      user: { name: "Test User" },
      workspace: {
        id: "ws-test-123",
        name: "Test Workspace",
        slug: "test",
      },
    }),
  })),
}));
vi.mock("../../src/core/region-resolver.ts", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/core/region-resolver.ts")
  >("../../src/core/region-resolver.ts");
  return {
    ...actual,
    resolveRoute: vi.fn().mockResolvedValue(null),
  };
});

import { saveGlobalCredentials } from "../../src/core/config.js";
import { registerAuthLogin } from "../../src/cli/commands/auth/login.js";

const mockSaveGlobalCredentials = vi.mocked(saveGlobalCredentials);

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "ano-profile-flag-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as never);
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  rmSync(tmpHome, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/**
 * Mirror the PRODUCTION command tree: root with `--profile` (env-bound
 * to ANO_PROFILE, no default) AND the auth login subcommand with its
 * own `--profile` (default "default"). The bug only surfaces with both
 * options present, which is the production shape.
 */
function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.addOption(
    new Option("-k, --key <key>", "API key").env("ANO_API_KEY"),
  );
  program.addOption(
    new Option("-e, --endpoint <url>", "API endpoint")
      .env("ANO_ENDPOINT")
      .default("https://api.ano.dev"),
  );
  // The bug-trigger: root --profile option, same -p short-flag as the
  // login subcommand's --profile. Commander routes the user value here.
  program.addOption(
    new Option("-p, --profile <name>", "Profile to read auth from").env(
      "ANO_PROFILE",
    ),
  );
  registerAuthLogin(program);
  return program;
}

describe("ano auth login — --profile flag is honored (v2.25.4 regression guard)", () => {
  it("`--profile prod` saves credentials to profiles.prod, NOT profiles.default", async () => {
    const program = makeProgram();
    await program.parseAsync([
      "node",
      "ano",
      "login",
      "--profile",
      "prod",
      "--key",
      "ano_usr_test123",
      "--endpoint",
      "https://api-staging.ano.dev",
    ]);

    expect(mockSaveGlobalCredentials).toHaveBeenCalledTimes(1);
    const savedCreds = mockSaveGlobalCredentials.mock.calls[0][0];
    expect(Object.keys(savedCreds.profiles)).toEqual(["prod"]);
    expect(savedCreds.profiles.prod?.key).toBe("ano_usr_test123");
    expect(savedCreds.profiles.prod).toBeDefined();
    expect(savedCreds.profiles.default).toBeUndefined();
  });

  it("without --profile, saves to profiles.default (preserves prior behavior)", async () => {
    const program = makeProgram();
    await program.parseAsync([
      "node",
      "ano",
      "login",
      "--key",
      "ano_usr_test456",
      "--endpoint",
      "https://api-staging.ano.dev",
    ]);

    expect(mockSaveGlobalCredentials).toHaveBeenCalledTimes(1);
    const savedCreds = mockSaveGlobalCredentials.mock.calls[0][0];
    expect(Object.keys(savedCreds.profiles)).toEqual(["default"]);
    expect(savedCreds.profiles.default?.key).toBe("ano_usr_test456");
  });

  it("ANO_PROFILE env honors the same path as --profile", async () => {
    process.env.ANO_PROFILE = "from-env";
    try {
      const program = makeProgram();
      await program.parseAsync([
        "node",
        "ano",
        "login",
        "--key",
        "ano_usr_envtest",
        "--endpoint",
        "https://api-staging.ano.dev",
      ]);

      expect(mockSaveGlobalCredentials).toHaveBeenCalledTimes(1);
      const savedCreds = mockSaveGlobalCredentials.mock.calls[0][0];
      expect(Object.keys(savedCreds.profiles)).toEqual(["from-env"]);
    } finally {
      delete process.env.ANO_PROFILE;
    }
  });
});
