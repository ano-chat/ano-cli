import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GlobalOptions } from "../../src/cli/types.js";
import { AuthError } from "../../src/core/errors.js";

// Mock config module before importing auth
vi.mock("../../src/core/config.js", () => ({
  loadProjectConfig: vi.fn(),
  loadGlobalCredentials: vi.fn(),
}));

import { resolveAuth } from "../../src/core/auth.js";
import {
  loadProjectConfig,
  loadGlobalCredentials,
} from "../../src/core/config.js";

const mockLoadProjectConfig = vi.mocked(loadProjectConfig);
const mockLoadGlobalCredentials = vi.mocked(loadGlobalCredentials);

function globals(overrides: Partial<GlobalOptions> = {}): GlobalOptions {
  return {
    endpoint: "https://api.ano.dev",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.ANO_API_KEY;
});

afterEach(() => {
  delete process.env.ANO_API_KEY;
});

describe("resolveAuth", () => {
  it("--key flag takes highest priority", () => {
    process.env.ANO_API_KEY = "env-key";
    mockLoadProjectConfig.mockReturnValue({ key: "project-key" });
    mockLoadGlobalCredentials.mockReturnValue({
      profiles: { default: { key: "global-key", created_at: "" } },
    });

    const result = resolveAuth(globals({ key: "flag-key" }));
    expect(result.key).toBe("flag-key");
    expect(result.source).toBe("flag");
    expect(result.endpoint).toBe("https://api.ano.dev");
  });

  it("ANO_API_KEY env var is second priority", () => {
    process.env.ANO_API_KEY = "env-key";
    mockLoadProjectConfig.mockReturnValue({ key: "project-key" });
    mockLoadGlobalCredentials.mockReturnValue({
      profiles: { default: { key: "global-key", created_at: "" } },
    });

    const result = resolveAuth(globals());
    expect(result.key).toBe("env-key");
    expect(result.source).toBe("env");
  });

  it("project config is third priority", () => {
    mockLoadProjectConfig.mockReturnValue({
      key: "project-key",
      endpoint: "https://custom.endpoint",
    });
    mockLoadGlobalCredentials.mockReturnValue({
      profiles: { default: { key: "global-key", created_at: "" } },
    });

    const result = resolveAuth(globals());
    expect(result.key).toBe("project-key");
    expect(result.source).toBe("project");
    expect(result.endpoint).toBe("https://custom.endpoint");
  });

  it("project config uses globals.endpoint when project has no endpoint", () => {
    mockLoadProjectConfig.mockReturnValue({ key: "project-key" });
    mockLoadGlobalCredentials.mockReturnValue(null);

    const result = resolveAuth(globals());
    expect(result.endpoint).toBe("https://api.ano.dev");
  });

  it("global credentials is fourth priority", () => {
    mockLoadProjectConfig.mockReturnValue(null);
    mockLoadGlobalCredentials.mockReturnValue({
      profiles: {
        default: {
          key: "global-key",
          endpoint: "https://global.endpoint",
          created_at: "2025-01-01",
        },
      },
    });

    const result = resolveAuth(globals());
    expect(result.key).toBe("global-key");
    expect(result.source).toBe("global");
    expect(result.endpoint).toBe("https://global.endpoint");
  });

  it("falls back to first profile if no default profile", () => {
    mockLoadProjectConfig.mockReturnValue(null);
    mockLoadGlobalCredentials.mockReturnValue({
      profiles: {
        work: { key: "work-key", created_at: "2025-01-01" },
      },
    });

    const result = resolveAuth(globals());
    expect(result.key).toBe("work-key");
    expect(result.source).toBe("global");
  });

  it("global credentials uses globals.endpoint when profile has no endpoint", () => {
    mockLoadProjectConfig.mockReturnValue(null);
    mockLoadGlobalCredentials.mockReturnValue({
      profiles: {
        default: { key: "global-key", created_at: "" },
      },
    });

    const result = resolveAuth(globals());
    expect(result.endpoint).toBe("https://api.ano.dev");
  });

  it("throws AuthError when no key is found anywhere", () => {
    mockLoadProjectConfig.mockReturnValue(null);
    mockLoadGlobalCredentials.mockReturnValue(null);

    expect(() => resolveAuth(globals())).toThrow(AuthError);
    expect(() => resolveAuth(globals())).toThrow("No API key found");
  });

  it("throws AuthError when credentials exist but have no profiles with keys", () => {
    mockLoadProjectConfig.mockReturnValue(null);
    mockLoadGlobalCredentials.mockReturnValue({ profiles: {} });

    expect(() => resolveAuth(globals())).toThrow(AuthError);
  });

  it("throws AuthError when project config exists but has no key", () => {
    mockLoadProjectConfig.mockReturnValue({ workspace_id: "ws-123" });
    mockLoadGlobalCredentials.mockReturnValue(null);

    expect(() => resolveAuth(globals())).toThrow(AuthError);
  });

  it("--profile selects a named profile from credentials", () => {
    mockLoadProjectConfig.mockReturnValue(null);
    mockLoadGlobalCredentials.mockReturnValue({
      profiles: {
        default: {
          key: "staging-key",
          endpoint: "https://api-staging.ano.dev",
          created_at: "",
        },
        local: {
          key: "local-key",
          endpoint: "http://127.0.0.1:3001",
          created_at: "",
        },
      },
    });

    const result = resolveAuth(globals({ profile: "local" }));
    expect(result.key).toBe("local-key");
    expect(result.endpoint).toBe("http://127.0.0.1:3001");
    expect(result.source).toBe("global");
  });

  it("--profile errors when the named profile is missing (lists alternatives)", () => {
    mockLoadProjectConfig.mockReturnValue(null);
    mockLoadGlobalCredentials.mockReturnValue({
      profiles: {
        default: { key: "k", created_at: "" },
        staging: { key: "k2", created_at: "" },
      },
    });

    expect(() => resolveAuth(globals({ profile: "local" }))).toThrow(
      /Profile 'local' not found.*default, staging/,
    );
  });

  it("--profile does NOT silently fall through to default when missing", () => {
    mockLoadProjectConfig.mockReturnValue(null);
    mockLoadGlobalCredentials.mockReturnValue({
      profiles: { default: { key: "default-key", created_at: "" } },
    });

    expect(() => resolveAuth(globals({ profile: "nonexistent" }))).toThrow(
      AuthError,
    );
  });
});

describe("resolveAuth — auto-local in monorepo", () => {
  let tmpRoot: string;
  let originalCwd: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.ANO_API_KEY;
    delete process.env.ANO_NO_AUTO_LOCAL;
    delete process.env.ANO_QUIET_PROFILE_HINT;
    tmpRoot = mkdtempSync(join(tmpdir(), "auth-auto-local-test-"));
    originalCwd = process.cwd();
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.ANO_NO_AUTO_LOCAL;
    delete process.env.ANO_QUIET_PROFILE_HINT;
    stderrSpy.mockRestore();
  });

  function withDevLocalRunning(): void {
    const pidDir = join(tmpRoot, ".ano", "dev", "postgres");
    mkdirSync(pidDir, { recursive: true });
    writeFileSync(join(pidDir, "postmaster.pid"), `${process.pid}\n`);
    process.chdir(tmpRoot);
  }

  it("picks `local` when CWD is under a running dev:local stack", () => {
    withDevLocalRunning();
    mockLoadProjectConfig.mockReturnValue(null);
    mockLoadGlobalCredentials.mockReturnValue({
      profiles: {
        default: {
          key: "staging-key",
          endpoint: "https://api-staging.ano.dev",
          created_at: "",
        },
        local: {
          key: "local-key",
          endpoint: "http://127.0.0.1:3001",
          created_at: "",
        },
      },
    });

    const result = resolveAuth(globals());
    expect(result.key).toBe("local-key");
    expect(result.source).toBe("auto-local");
    expect(result.endpoint).toBe("http://127.0.0.1:3001");
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringMatching(/profile: local/),
    );
  });

  it("does NOT auto-pick local when CWD is outside any dev:local stack", () => {
    process.chdir(tmpdir()); // not the monorepo
    mockLoadProjectConfig.mockReturnValue(null);
    mockLoadGlobalCredentials.mockReturnValue({
      profiles: {
        default: { key: "staging-key", created_at: "" },
        local: { key: "local-key", created_at: "" },
      },
    });

    const result = resolveAuth(globals());
    expect(result.key).toBe("staging-key");
    expect(result.source).toBe("global");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("does NOT auto-pick local when no `local` profile exists", () => {
    withDevLocalRunning();
    mockLoadProjectConfig.mockReturnValue(null);
    mockLoadGlobalCredentials.mockReturnValue({
      profiles: { default: { key: "staging-key", created_at: "" } },
    });

    const result = resolveAuth(globals());
    expect(result.key).toBe("staging-key");
    expect(result.source).toBe("global");
  });

  it("ANO_NO_AUTO_LOCAL=1 disables the auto-pick", () => {
    withDevLocalRunning();
    process.env.ANO_NO_AUTO_LOCAL = "1";
    mockLoadProjectConfig.mockReturnValue(null);
    mockLoadGlobalCredentials.mockReturnValue({
      profiles: {
        default: { key: "staging-key", created_at: "" },
        local: { key: "local-key", created_at: "" },
      },
    });

    const result = resolveAuth(globals());
    expect(result.key).toBe("staging-key");
    expect(result.source).toBe("global");
  });

  it("ANO_NO_AUTO_LOCAL=true (project-wide convention) also disables", () => {
    withDevLocalRunning();
    process.env.ANO_NO_AUTO_LOCAL = "true";
    mockLoadProjectConfig.mockReturnValue(null);
    mockLoadGlobalCredentials.mockReturnValue({
      profiles: {
        default: { key: "staging-key", created_at: "" },
        local: { key: "local-key", created_at: "" },
      },
    });

    const result = resolveAuth(globals());
    expect(result.source).toBe("global");
  });

  it("ANO_NO_AUTO_LOCAL=TRUE (case-insensitive) also disables", () => {
    withDevLocalRunning();
    process.env.ANO_NO_AUTO_LOCAL = "TRUE";
    mockLoadProjectConfig.mockReturnValue(null);
    mockLoadGlobalCredentials.mockReturnValue({
      profiles: {
        default: { key: "staging-key", created_at: "" },
        local: { key: "local-key", created_at: "" },
      },
    });

    const result = resolveAuth(globals());
    expect(result.source).toBe("global");
  });

  it("explicit --profile default still works (overrides auto-pick)", () => {
    withDevLocalRunning();
    mockLoadProjectConfig.mockReturnValue(null);
    mockLoadGlobalCredentials.mockReturnValue({
      profiles: {
        default: { key: "staging-key", created_at: "" },
        local: { key: "local-key", created_at: "" },
      },
    });

    const result = resolveAuth(globals({ profile: "default" }));
    expect(result.key).toBe("staging-key");
    expect(result.source).toBe("global");
  });

  it("ANO_QUIET_PROFILE_HINT=1 suppresses the stderr hint but still picks local", () => {
    withDevLocalRunning();
    process.env.ANO_QUIET_PROFILE_HINT = "1";
    mockLoadProjectConfig.mockReturnValue(null);
    mockLoadGlobalCredentials.mockReturnValue({
      profiles: {
        default: { key: "staging-key", created_at: "" },
        local: { key: "local-key", created_at: "" },
      },
    });

    const result = resolveAuth(globals());
    expect(result.source).toBe("auto-local");
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
