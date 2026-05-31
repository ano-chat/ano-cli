import { describe, expect, it, vi, beforeEach } from "vitest";
import { Command } from "commander";

const searchMessagesMock = vi.fn();
const resolveAuthMock = vi.fn();
const outputMock = vi.fn();

vi.mock("../../src/core/api-client.js", () => ({
  createApiClient: () => ({
    searchMessages: searchMessagesMock,
  }),
}));
vi.mock("../../src/core/auth.js", () => ({
  resolveAuth: resolveAuthMock,
}));
vi.mock("../../src/core/output.js", () => ({
  output: outputMock,
  outputError: vi.fn(),
}));

const { registerSearchMessages } =
  await import("../../src/cli/commands/messages/search.js");

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option("-w, --workspace <id>", "Workspace ID");
  program.option("--agent", "Agent output");
  const messages = program.command("messages");
  registerSearchMessages(messages);
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveAuthMock.mockReturnValue({
    key: "k",
    endpoint: "https://api-us.ano.dev",
    source: "global",
    workspace_id: "ws-1",
  });
  searchMessagesMock.mockResolvedValue({
    messages: [
      {
        id: "m1",
        channel: "general",
        sender: { name: "Ruben" },
        content: "Codex",
        timestamp: 1,
      },
    ],
  });
});

describe("messages search", () => {
  it("uses REST when no warm Zero search result is available", async () => {
    await buildProgram().parseAsync(
      ["messages", "search", "Codex", "--limit", "3", "--agent"],
      { from: "user" },
    );

    expect(searchMessagesMock).toHaveBeenCalledWith({
      query: "Codex",
      workspace_id: "ws-1",
      limit: 3,
    });
  });
});
