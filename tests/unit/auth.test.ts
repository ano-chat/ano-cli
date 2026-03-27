import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
});
