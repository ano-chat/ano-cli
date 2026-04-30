// Integration tests for `ano auth login --print-workspaces`.
//
// Why this exists separately from auth-complete.test.ts: complete.ts uses
// the cached session from a prior login run; --print-workspaces is the
// step that creates that session and emits the JSON line for orchestrators.
// Two tests covers the full handshake.
//
// We mock the OAuth flow + fetch so the test doesn't need a real WorkOS
// authorize page or browser.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Hoist-safe mocks: factories may not reference test-scope vars.
vi.mock("../../src/core/oauth-flow.js", () => ({
  runOAuthLogin: vi.fn(),
  DEFAULT_OAUTH_PORT: 41729,
  OAUTH_CALLBACK_PATH: "/cli-callback",
}));
vi.mock("../../src/core/config.js", () => ({
  loadGlobalCredentials: vi.fn(),
  saveGlobalCredentials: vi.fn(),
  loadProjectConfig: vi.fn(),
}));
vi.mock("../../src/core/api-client.js", () => ({
  createApiClient: vi.fn(),
}));

import { runOAuthLogin } from "../../src/core/oauth-flow.js";
import { loadSession, sessionPath } from "../../src/core/oauth-session.js";
import { registerAuthLogin } from "../../src/cli/commands/auth/login.js";

const mockRunOAuthLogin = vi.mocked(runOAuthLogin);

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "ano-print-ws-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as never);
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  rmSync(tmpHome, { recursive: true, force: true });
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
  // The login command reads `globals.endpoint` from optsWithGlobals — we
  // need a parent command with that registered, even if we only invoke
  // `login`. Mirror what root.ts does for `--endpoint`.
  program.option("--endpoint <url>", "API endpoint");
  program.option("-k, --key <key>", "API key");
  registerAuthLogin(program);
  return program;
}

describe("ano auth login --print-workspaces (integration)", () => {
  it("happy path: emits workspace JSON, writes session file 0o600, exits 0", async () => {
    mockRunOAuthLogin.mockResolvedValue({
      accessToken: "tok_alpha",
      user: { id: "user_01H_alpha", email: "alpha@example.com" },
    });
    mockFetch(({ url }) => {
      if (url.endsWith("/api/cli-keys/workspaces")) {
        return new Response(
          JSON.stringify({
            workspaces: [
              { id: "ws_a", name: "Acme", logo_url: null },
              { id: "ws_b", name: "Beta", logo_url: "https://x/y.png" },
            ],
          }),
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
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    await makeProgram().parseAsync([
      "node",
      "ano",
      "--endpoint",
      "https://api-staging.ano.dev",
      "login",
      "--print-workspaces",
    ]);

    stdoutSpy.mockRestore();
    consoleLog.mockRestore();

    // Stdout: exactly one JSON line, no other prose.
    expect(stdoutChunks.length).toBe(1);
    const parsed = JSON.parse(stdoutChunks[0]!.trim());
    expect(parsed.workspaces).toHaveLength(2);
    expect(parsed.workspaces[0]).toEqual({
      id: "ws_a",
      name: "Acme",
      logo_url: null,
    });

    // No console.log fired (orchestrator-mode suppresses prose).
    expect(consoleLog).not.toHaveBeenCalled();

    // Session cached for `auth complete` to consume.
    const session = loadSession();
    expect(session).toMatchObject({
      accessToken: "tok_alpha",
      endpoint: "https://api-staging.ano.dev",
      userId: "user_01H_alpha",
    });

    // File mode 0o600.
    expect(statSync(sessionPath()).mode & 0o777).toBe(0o600);

    // Mint endpoint NOT called — print mode exits without minting.
    const mockFetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls as Array<[string, RequestInit | undefined]>;
    expect(mockFetchCalls.some(([url]) => url.endsWith("/api/cli-keys"))).toBe(
      false,
    );
  });

  it("emits empty workspaces JSON + still caches session when account has zero memberships", async () => {
    mockRunOAuthLogin.mockResolvedValue({
      accessToken: "tok_zero",
    });
    mockFetch(({ url }) => {
      if (url.endsWith("/api/cli-keys/workspaces")) {
        return new Response(JSON.stringify({ workspaces: [] }), {
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    });

    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(
      (chunk: string | Uint8Array) => {
        stdoutChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
        return true;
      },
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    await makeProgram().parseAsync([
      "node",
      "ano",
      "--endpoint",
      "https://api-staging.ano.dev",
      "login",
      "--print-workspaces",
    ]);

    expect(JSON.parse(stdoutChunks[0]!.trim())).toEqual({ workspaces: [] });
    // Session is still cached so `auth complete` can be retried within
    // the 5-min TTL after the user creates a workspace.
    expect(loadSession()).not.toBeNull();
  });

  it("rejects --print-workspaces + --key with USAGE (1)", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      makeProgram().parseAsync([
        "node",
        "ano",
        "--key",
        "ano_usr_test",
        "login",
        "--print-workspaces",
      ]),
    ).rejects.toThrow(/process\.exit\(1\)/);

    // OAuth flow should NOT have been invoked.
    expect(mockRunOAuthLogin).not.toHaveBeenCalled();
    // Session NOT created.
    expect(loadSession()).toBeNull();
  });

  it("emits no console.log prose to stdout in print mode (orchestrator-clean output)", async () => {
    mockRunOAuthLogin.mockResolvedValue({ accessToken: "tok" });
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ workspaces: [] }), { status: 200 }),
      ),
    );

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await makeProgram().parseAsync([
      "node",
      "ano",
      "--endpoint",
      "https://api-staging.ano.dev",
      "login",
      "--print-workspaces",
    ]);

    // The login flow has multiple console.log calls in the interactive
    // path ("Signing in to Ano...", browser-fallback URL hint, etc.). In
    // print mode all of those are suppressed via the local `log` shim and
    // by passing `onAuthorizeUrl: undefined` to runOAuthLogin.
    expect(consoleLog).not.toHaveBeenCalled();
  });
});
