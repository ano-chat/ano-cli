import { describe, expect, it, vi, beforeEach } from "vitest";
import { Command } from "commander";
import {
  setActiveZeroClient,
  _setLastStatusForTests,
} from "../../src/zero/active-client.js";
import { _clearChannelRefCacheForTests } from "../../src/cli/commands/messages/channel-target.js";

const readMessagesMock = vi.fn();
const listChannelsMock = vi.fn();
const resolveAuthMock = vi.fn();
const outputMock = vi.fn();

vi.mock("../../src/core/api-client.js", () => ({
  createApiClient: () => ({
    readMessages: readMessagesMock,
    listChannels: listChannelsMock,
  }),
}));
vi.mock("../../src/core/auth.js", () => ({
  resolveAuth: resolveAuthMock,
}));
vi.mock("../../src/core/output.js", () => ({
  output: outputMock,
  outputError: vi.fn(),
}));

const { registerReadMessages } =
  await import("../../src/cli/commands/messages/read.js");

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option("-w, --workspace <id>", "Workspace ID");
  program.option("--agent", "Agent output");
  const messages = program.command("messages");
  registerReadMessages(messages);
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();
  _clearChannelRefCacheForTests();
  setActiveZeroClient(null);
  _setLastStatusForTests("connected");
  resolveAuthMock.mockReturnValue({
    key: "k",
    endpoint: "https://api-us.ano.dev",
    source: "global",
    workspace_id: "ws-1",
  });

  listChannelsMock.mockResolvedValue({
    channels: [
      {
        id: "ca4630cd-6a20-4407-a053-73fe7ccf1a16",
        name: "general",
        type: "channel",
        is_private: false,
        workspace_id: "ws-1",
      },
    ],
  });
  readMessagesMock.mockResolvedValue({
    messages: [
      {
        id: "m1",
        sender: { name: "Ruben" },
        content: "hello",
        timestamp: 1,
      },
    ],
  });
});

describe("messages read target resolution", () => {
  it("caches successful channel-name resolution inside the warm process", async () => {
    const program = buildProgram();

    await program.parseAsync(
      ["messages", "read", "general", "--limit", "3", "--agent"],
      { from: "user" },
    );
    await program.parseAsync(
      ["messages", "read", "general", "--limit", "3", "--agent"],
      { from: "user" },
    );

    expect(listChannelsMock).toHaveBeenCalledTimes(1);
    expect(readMessagesMock).toHaveBeenCalledTimes(2);
  });

  it("reads #channel in one CLI command without startup context", async () => {
    await buildProgram().parseAsync(
      ["messages", "read", "#general", "--limit", "3", "--agent"],
      { from: "user" },
    );

    expect(listChannelsMock).toHaveBeenCalledTimes(1);
    expect(readMessagesMock).toHaveBeenCalledWith({
      channel_id: "ca4630cd-6a20-4407-a053-73fe7ccf1a16",
      limit: 3,
    });
  });

  it("reads by channel id without listing channels", async () => {
    await buildProgram().parseAsync(
      [
        "messages",
        "read",
        "--channel",
        "ca4630cd-6a20-4407-a053-73fe7ccf1a16",
        "--limit",
        "3",
        "--agent",
      ],
      { from: "user" },
    );

    expect(listChannelsMock).not.toHaveBeenCalled();
    expect(readMessagesMock).toHaveBeenCalledWith({
      channel_id: "ca4630cd-6a20-4407-a053-73fe7ccf1a16",
      limit: 3,
    });
  });

  it("uses Zero channel rows before REST channel listing", async () => {
    let zeroRuns = 0;
    setActiveZeroClient({
      zero: {
        run: async () =>
          zeroRuns++ === 0
            ? [
                {
                  id: "b1d88992-7dc4-4823-ae8d-b4bfec112447",
                  name: "random",
                  type: "channel",
                  topic: null,
                  is_private: false,
                  workspace_id: "ws-1",
                },
              ]
            : [],
      } as never,
      userId: "user-1",
      auth: {} as never,
      stats: () => ({
        replicaPath: "",
        replicaSizeBytes: 1,
        connectionStatus: "connected",
      }),
      dispose: async () => {},
    });

    await buildProgram().parseAsync(
      ["messages", "read", "#random", "--limit", "3", "--agent"],
      { from: "user" },
    );

    expect(listChannelsMock).not.toHaveBeenCalled();
    expect(readMessagesMock).toHaveBeenCalledWith({
      channel_id: "b1d88992-7dc4-4823-ae8d-b4bfec112447",
      limit: 3,
    });
  });
});
