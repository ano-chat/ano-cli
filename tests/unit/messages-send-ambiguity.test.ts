import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";

/**
 * Fix: a `--channel-name` send with no resolvable workspace scope, on a key
 * that can see >1 workspace, must REFUSE (names aren't unique across
 * workspaces — the server would silently land it in the wrong tenant and
 * still return ok:true). Scope precedence: --workspace → pinned profile
 * workspace_id → (if neither) ambiguity guard.
 */

const sendMessageMock = vi.fn();
const listWorkspacesMock = vi.fn();
const resolveAuthMock = vi.fn();

vi.mock("../../src/core/api-client.js", () => ({
  createApiClient: () => ({
    sendMessage: sendMessageMock,
    listWorkspaces: listWorkspacesMock,
  }),
}));
vi.mock("../../src/core/auth.js", () => ({
  resolveAuth: resolveAuthMock,
}));
vi.mock("../../src/core/output.js", () => ({
  output: vi.fn(),
  outputError: vi.fn(),
}));
vi.mock("../../src/zero/writes.js", () => ({
  sendTextMessageViaZero: vi.fn(async () => null),
}));

const { registerSendMessage } =
  await import("../../src/cli/commands/messages/send.js");

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option("-w, --workspace <id>", "Workspace ID");
  const messages = program.command("messages");
  registerSendMessage(messages);
  return program;
}

const TWO_WS = [
  { id: "ws-ano", name: "Ano" },
  { id: "ws-lol", name: "League of Legends" },
];

beforeEach(() => {
  sendMessageMock.mockReset();
  listWorkspacesMock.mockReset();
  resolveAuthMock.mockReset();
  sendMessageMock.mockResolvedValue({ message_id: "m-1", channel_id: "c-1" });
  // Default: key with no pinned workspace.
  resolveAuthMock.mockReturnValue({
    key: "k",
    endpoint: "https://api-us.ano.dev",
    source: "global",
  });
});

describe("messages send — ambiguous --channel-name guard", () => {
  it("REFUSES an unscoped --channel-name when the key spans >1 workspace", async () => {
    listWorkspacesMock.mockResolvedValue({ workspaces: TWO_WS });
    // tests/setup.ts turns the USAGE-exit into a throw("process.exit(1)").
    // The key assertion is that the send was PREVENTED (no wrong-tenant write).
    await expect(
      buildProgram().parseAsync(
        ["messages", "send", "--channel-name", "random", "hi"],
        { from: "user" },
      ),
    ).rejects.toThrow(/process\.exit unexpectedly called with "1"/);
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(listWorkspacesMock).toHaveBeenCalledTimes(1);
  });

  it("PROCEEDS for a single-workspace key, scoping to that workspace", async () => {
    listWorkspacesMock.mockResolvedValue({ workspaces: [TWO_WS[0]] });
    await buildProgram().parseAsync(
      ["messages", "send", "--channel-name", "random", "hi"],
      { from: "user" },
    );
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock.mock.calls[0]![0].workspace_id).toBe("ws-ano");
  });

  it("uses explicit --workspace WITHOUT listing workspaces", async () => {
    await buildProgram().parseAsync(
      [
        "--workspace",
        "ws-lol",
        "messages",
        "send",
        "--channel-name",
        "random",
        "hi",
      ],
      { from: "user" },
    );
    expect(listWorkspacesMock).not.toHaveBeenCalled();
    expect(sendMessageMock.mock.calls[0]![0].workspace_id).toBe("ws-lol");
  });

  it("uses the pinned profile workspace_id WITHOUT listing workspaces", async () => {
    resolveAuthMock.mockReturnValue({
      key: "k",
      endpoint: "https://api-us.ano.dev",
      source: "global",
      workspace_id: "ws-ano",
    });
    await buildProgram().parseAsync(
      ["messages", "send", "--channel-name", "random", "hi"],
      { from: "user" },
    );
    expect(listWorkspacesMock).not.toHaveBeenCalled();
    expect(sendMessageMock.mock.calls[0]![0].workspace_id).toBe("ws-ano");
  });

  it("a literal --channel <id> is exempt (globally unique — no guard, no listing)", async () => {
    await buildProgram().parseAsync(
      ["messages", "send", "--channel", "c-123", "hi"],
      { from: "user" },
    );
    expect(listWorkspacesMock).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });
});
