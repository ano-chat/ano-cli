import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";

// Mock the config module so we capture what `auth complete` writes to
// credentials.json without touching the real ~/.config/ano dir.
// vi.mock is hoisted, so the factory cannot reference test-scope vars —
// it creates fresh vi.fn()s here, and the test grabs them via vi.mocked()
// after importing.
vi.mock("../../src/core/config.js", () => ({
  loadGlobalCredentials: vi.fn(),
  saveGlobalCredentials: vi.fn(),
  loadProjectConfig: vi.fn(),
}));

import {
  saveSession,
  loadSession,
  sessionPath,
} from "../../src/core/oauth-session.js";
import { registerAuthComplete } from "../../src/cli/commands/auth/complete.js";
import {
  loadGlobalCredentials,
  saveGlobalCredentials,
} from "../../src/core/config.js";

const mockLoadGlobalCredentials = vi.mocked(loadGlobalCredentials);
const mockSaveGlobalCredentials = vi.mocked(saveGlobalCredentials);

let tmpHome: string;
let originalHome: string | undefined;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "ano-complete-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  mockLoadGlobalCredentials.mockReset();
  mockSaveGlobalCredentials.mockReset();
  // Default: no existing creds. `auth complete` will pass through to a
  // fresh `{ profiles: {} }`.
  mockLoadGlobalCredentials.mockReturnValue(null);

  // commander's `process.exit` stub. Throw instead of really exiting so
  // the test stays observable.
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as never);
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  rmSync(tmpHome, { recursive: true, force: true });
  exitSpy.mockRestore();
  vi.restoreAllMocks();
});

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function mockFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  globalThis.fetch = vi
    .fn()
    .mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(handler({ url, init })),
    ) as unknown as typeof fetch;
}

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerAuthComplete(program);
  return program;
}

describe("ano auth complete (integration)", () => {
  it("happy path: reads cached session, mints, saves profile, deletes session", async () => {
    saveSession({
      accessToken: "tok_alpha",
      endpoint: "https://api-staging.ano.dev",
      clientId: "client_test",
      createdAt: Date.now(),
    });

    const calls: FetchCall[] = [];
    mockFetch((call) => {
      calls.push(call);
      // New cross-region list path (preferred). Staging mounts /cp/* on
      // the Worker, so the global lister succeeds and the legacy
      // /api/cli-keys/workspaces fallback never fires.
      if (call.url.endsWith("/cp/workspaces")) {
        return new Response(
          JSON.stringify({
            workspaces: [
              {
                id: "ws_a",
                name: "Acme",
                region: "us",
                archivedAt: null,
              },
              {
                id: "ws_b",
                name: "Beta",
                region: "us",
                archivedAt: null,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (call.url.endsWith("/api/cli-keys")) {
        return new Response(
          JSON.stringify({ api_key: "ano_usr_minted_xyz", key_id: "k1" }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });

    const stdoutChunks: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stdoutChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
        return true;
      });

    await makeProgram().parseAsync([
      "node",
      "ano",
      "complete",
      "--workspace-id",
      "ws_a",
    ]);

    stdoutSpy.mockRestore();

    // Two calls: the cross-region lister + the mint. Staging is NOT
    // the apex, so `regionalApiUrl()` (which maps to PROD hosts only)
    // must NOT fire — otherwise we'd redirect staging traffic to
    // production. `region` is saved as a tag on the profile, but the
    // configured staging endpoint stays put for routing.
    expect(calls.length).toBe(2);
    expect(calls[0]?.url).toBe("https://api-staging.ano.dev/cp/workspaces");
    expect(calls[0]?.init?.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer tok_alpha" }),
    );
    expect(calls[1]?.url).toBe("https://api-staging.ano.dev/api/cli-keys");
    expect(calls[1]?.init?.method).toBe("POST");

    // Profile saved with the picked workspace's name.
    expect(mockSaveGlobalCredentials).toHaveBeenCalledTimes(1);
    const saved = mockSaveGlobalCredentials.mock.calls[0]?.[0] as {
      profiles: Record<string, unknown>;
    };
    expect(saved.profiles.default).toMatchObject({
      key: "ano_usr_minted_xyz",
      workspace_name: "Acme",
      // Endpoint stays on staging; region is informational only.
      endpoint: "https://api-staging.ano.dev",
      region: "us",
    });

    // Session file deleted after success.
    expect(loadSession()).toBeNull();
    expect(existsSync(sessionPath())).toBe(false);

    // Single JSON line on stdout for orchestrators.
    const json = stdoutChunks.find((c) => c.startsWith("{"));
    expect(json).toBeTruthy();
    expect(JSON.parse(json!.trim())).toMatchObject({
      ok: true,
      profile: "default",
      workspace: { id: "ws_a", name: "Acme" },
    });
  });

  it("exits with AUTH (3) when no session is cached", async () => {
    expect(loadSession()).toBeNull();

    const stderrChunks: string[] = [];
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stderrChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
        return true;
      });

    await expect(
      makeProgram().parseAsync([
        "node",
        "ano",
        "complete",
        "--workspace-id",
        "ws_a",
      ]),
    ).rejects.toThrow(/process\.exit\(3\)/);

    stderrSpy.mockRestore();

    expect(mockSaveGlobalCredentials).not.toHaveBeenCalled();
    expect(stderrChunks.join("\n")).toMatch(/no cached login session/);
  });

  it("exits with NOT_FOUND (2) when picked workspace is not in memberships", async () => {
    saveSession({
      accessToken: "tok_alpha",
      endpoint: "https://api.ano.dev",
      clientId: "client_test",
      createdAt: Date.now(),
    });

    mockFetch(({ url }) => {
      if (url.endsWith("/api/cli-keys/workspaces")) {
        return new Response(
          JSON.stringify({
            workspaces: [{ id: "ws_only_one", name: "Only", logo_url: null }],
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });

    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(
      makeProgram().parseAsync([
        "node",
        "ano",
        "complete",
        "--workspace-id",
        "ws_not_a_member",
      ]),
    ).rejects.toThrow(/process\.exit\(2\)/);

    expect(mockSaveGlobalCredentials).not.toHaveBeenCalled();
    // Session NOT deleted on failure — user can retry with a valid id
    // within the 5-min TTL.
    expect(loadSession()).not.toBeNull();
  });

  it("region from /cp/workspaces drives the regional endpoint (no /route hop needed)", async () => {
    saveSession({
      accessToken: "tok_alpha",
      endpoint: "https://api.ano.dev",
      clientId: "client_test",
      createdAt: Date.now(),
    });

    const calls: FetchCall[] = [];
    mockFetch((call) => {
      calls.push(call);
      if (call.url.endsWith("/cp/workspaces")) {
        return new Response(
          JSON.stringify({
            workspaces: [
              { id: "ws_a", name: "Acme", region: "eu", archivedAt: null },
            ],
          }),
          { status: 200 },
        );
      }
      if (call.url.endsWith("/api/cli-keys")) {
        return new Response(
          JSON.stringify({ api_key: "ano_usr_minted_xyz", key_id: "k1" }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await makeProgram().parseAsync([
      "node",
      "ano",
      "complete",
      "--workspace-id",
      "ws_a",
    ]);

    // Mint hit api-eu (workspace.region drove the regional pin).
    const mintCall = calls.find((c) => c.url.endsWith("/api/cli-keys"));
    expect(mintCall?.url).toBe("https://api-eu.ano.dev/api/cli-keys");
    // No /route call was needed — workspace.region was authoritative.
    const routeCall = calls.find((c) => c.url.includes("/route"));
    expect(routeCall).toBeUndefined();

    const saved = mockSaveGlobalCredentials.mock.calls[0]?.[0] as {
      profiles: Record<
        string,
        { endpoint?: string; workspace_id?: string; region?: string }
      >;
    };
    expect(saved.profiles.default).toMatchObject({
      endpoint: "https://api-eu.ano.dev",
      workspace_id: "ws_a",
      region: "eu",
    });
  });

  it("falls back to /api/cli-keys/workspaces + /route when /cp/workspaces 404s (older server)", async () => {
    saveSession({
      accessToken: "tok_alpha",
      endpoint: "https://api.ano.dev",
      clientId: "client_test",
      createdAt: Date.now(),
    });

    mockFetch((call) => {
      // Simulate older server without /cp/* — legacy lister responds,
      // global one 404s.
      if (call.url.endsWith("/cp/workspaces")) {
        return new Response("not found", { status: 404 });
      }
      if (call.url.endsWith("/api/cli-keys/workspaces")) {
        return new Response(
          JSON.stringify({
            workspaces: [{ id: "ws_a", name: "Acme", logo_url: null }],
          }),
          { status: 200 },
        );
      }
      if (call.url.endsWith("/api/cli-keys")) {
        return new Response(
          JSON.stringify({ api_key: "ano_usr_minted_xyz", key_id: "k1" }),
          { status: 200 },
        );
      }
      // /route returns 500 → resolver yields null → caller keeps apex.
      return new Response("boom", { status: 500 });
    });

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await makeProgram().parseAsync([
      "node",
      "ano",
      "complete",
      "--workspace-id",
      "ws_a",
    ]);

    const saved = mockSaveGlobalCredentials.mock.calls[0]?.[0] as {
      profiles: Record<string, { endpoint?: string }>;
    };
    // saveProfile normalizes api.ano.dev → undefined.
    expect(saved.profiles.default?.endpoint).toBeUndefined();
  });

  it("never rewrites staging/custom endpoints to prod regional hosts (env-leak guard)", async () => {
    // `regionalApiUrl()` maps to PRODUCTION hosts (api-us / api-eu).
    // A staging session whose workspace has `region: "us"` MUST keep
    // its mint on staging — otherwise we'd send the staging WorkOS
    // token to prod and save a key pointing at the wrong environment.
    // This is the apex-only guard regression test.
    saveSession({
      accessToken: "tok_stg",
      endpoint: "https://api-staging.ano.dev",
      clientId: "client_test",
      createdAt: Date.now(),
    });

    const calls: FetchCall[] = [];
    mockFetch((call) => {
      calls.push(call);
      if (call.url.endsWith("/cp/workspaces")) {
        return new Response(
          JSON.stringify({
            workspaces: [
              { id: "ws_a", name: "Acme", region: "us", archivedAt: null },
            ],
          }),
          { status: 200 },
        );
      }
      if (call.url.endsWith("/api/cli-keys")) {
        return new Response(
          JSON.stringify({ api_key: "ano_usr_stg", key_id: "k1" }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await makeProgram().parseAsync([
      "node",
      "ano",
      "complete",
      "--workspace-id",
      "ws_a",
    ]);

    // Critical: no call landed on a production regional host.
    for (const c of calls) {
      expect(c.url).not.toMatch(/api-us\.ano\.dev|api-eu\.ano\.dev/);
    }
    // Mint went to staging.
    expect(
      calls.some((c) => c.url === "https://api-staging.ano.dev/api/cli-keys"),
    ).toBe(true);

    const saved = mockSaveGlobalCredentials.mock.calls[0]?.[0] as {
      profiles: Record<string, { endpoint?: string; region?: string }>;
    };
    expect(saved.profiles.default?.endpoint).toBe(
      "https://api-staging.ano.dev",
    );
    // Region still saved (informational tag).
    expect(saved.profiles.default?.region).toBe("us");
  });

  it("exits with AUTH (3) when the cached session has expired", async () => {
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
    saveSession({
      accessToken: "tok_old",
      endpoint: "https://api.ano.dev",
      clientId: "client_test",
      createdAt: sixMinutesAgo,
    });

    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(
      makeProgram().parseAsync([
        "node",
        "ano",
        "complete",
        "--workspace-id",
        "ws_a",
      ]),
    ).rejects.toThrow(/process\.exit\(3\)/);

    expect(mockSaveGlobalCredentials).not.toHaveBeenCalled();
  });
});
