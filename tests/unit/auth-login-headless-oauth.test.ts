import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

/**
 * Headless/background OAuth fixes:
 *  - `--timeout <seconds>` is plumbed into runOAuthLogin as timeoutMs.
 *  - In `--print-workspaces` mode the authorize URL is STILL surfaced
 *    (via onAuthorizeUrl → stderr) rather than suppressed, so a shell where
 *    the browser can't auto-open can complete the flow instead of timing out.
 */

const runOAuthLoginMock = vi.fn();
const listWorkspacesGlobalMock = vi.fn();
const listWorkspacesMock = vi.fn();
const saveSessionMock = vi.fn();

vi.mock("../../src/core/oauth-flow.js", () => ({
  runOAuthLogin: runOAuthLoginMock,
  DEFAULT_OAUTH_PORT: 41729,
  OAUTH_CALLBACK_PATH: "/cli-callback",
}));
vi.mock("../../src/cli/commands/auth/auth-helpers.js", () => ({
  listWorkspaces: listWorkspacesMock,
  listWorkspacesGlobal: listWorkspacesGlobalMock,
  mintCliKey: vi.fn(),
  saveProfile: vi.fn(),
  regionalApiUrl: (r: string) => `https://api-${r}.ano.dev`,
  stripTrailingSlash: (s: string) => s.replace(/\/+$/, ""),
}));
vi.mock("../../src/core/oauth-session.js", () => ({
  saveSession: saveSessionMock,
}));
vi.mock("../../src/core/api-client.js", () => ({
  createApiClient: () => ({}),
}));

const { registerAuthLogin } =
  await import("../../src/cli/commands/auth/login.js");

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option("-e, --endpoint <url>", "API endpoint");
  program.option("-p, --profile <name>", "Profile");
  const auth = program.command("auth");
  registerAuthLogin(auth);
  return program;
}

beforeEach(() => {
  runOAuthLoginMock.mockReset();
  listWorkspacesGlobalMock.mockReset();
  saveSessionMock.mockReset();
  runOAuthLoginMock.mockResolvedValue({
    accessToken: "at",
    user: { id: "u1" },
  });
  listWorkspacesGlobalMock.mockResolvedValue([]); // empty → clean JSON exit
});

const callArgs = () => runOAuthLoginMock.mock.calls[0]![0];

describe("auth login — headless OAuth", () => {
  it("surfaces the authorize URL even in --print-workspaces mode (not undefined)", async () => {
    await buildProgram().parseAsync(
      [
        "auth",
        "login",
        "--print-workspaces",
        "--endpoint",
        "https://api-us.ano.dev",
      ],
      { from: "user" },
    );
    expect(runOAuthLoginMock).toHaveBeenCalledTimes(1);
    expect(typeof callArgs().onAuthorizeUrl).toBe("function");
  });

  it("--print-workspaces onAuthorizeUrl writes to STDERR, keeping stdout clean", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await buildProgram().parseAsync(
      [
        "auth",
        "login",
        "--print-workspaces",
        "--endpoint",
        "https://api-us.ano.dev",
      ],
      { from: "user" },
    );
    callArgs().onAuthorizeUrl("https://auth.example/authorize?x=1");
    expect(errSpy).toHaveBeenCalled();
    const wrote = errSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(wrote).toContain("https://auth.example/authorize?x=1");
    errSpy.mockRestore();
  });

  it("--timeout <seconds> is plumbed to runOAuthLogin as timeoutMs", async () => {
    await buildProgram().parseAsync(
      [
        "auth",
        "login",
        "--print-workspaces",
        "--timeout",
        "600",
        "--endpoint",
        "https://api-us.ano.dev",
      ],
      { from: "user" },
    );
    expect(callArgs().timeoutMs).toBe(600_000);
  });

  it("omits timeoutMs when --timeout not passed (uses runOAuthLogin's default)", async () => {
    await buildProgram().parseAsync(
      [
        "auth",
        "login",
        "--print-workspaces",
        "--endpoint",
        "https://api-us.ano.dev",
      ],
      { from: "user" },
    );
    expect(callArgs().timeoutMs).toBeUndefined();
  });
});
