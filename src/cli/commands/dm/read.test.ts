import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const resolveDmMock = vi.fn();
const readMessagesMock = vi.fn();
const readMessagesViaZeroMock = vi.fn();
const outputMock = vi.fn();
const outputErrorMock = vi.fn();

vi.mock("../../../core/api-client.js", () => ({
  createApiClient: () => ({
    resolveDm: resolveDmMock,
    readMessages: readMessagesMock,
  }),
}));
vi.mock("../../../core/auth.js", () => ({
  resolveAuth: () => ({
    key: "k",
    endpoint: "http://x",
    workspace_id: "ws-auth",
    source: "profile",
  }),
}));
vi.mock("../../../core/output.js", () => ({
  output: outputMock,
  outputError: outputErrorMock,
}));
vi.mock("../../../zero/reads.js", () => ({
  readMessagesViaZero: readMessagesViaZeroMock,
}));

const { registerReadDm } = await import("./read.js");

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerReadDm(program);
  return program;
}

beforeEach(() => {
  resolveDmMock.mockReset();
  readMessagesMock.mockReset();
  readMessagesViaZeroMock.mockReset();
  outputMock.mockReset();
  outputErrorMock.mockReset();
  vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("__test_exit__");
  });
});

describe("ano dm read", () => {
  it("resolves the DM read-only, then reads messages via REST fallback", async () => {
    resolveDmMock.mockResolvedValue({
      channel: {
        channel_id: "ch-dm",
        channel_type: "dm",
        participant_names: ["Alice"],
        participants: [],
        last_message_at: null,
        unread_count: 0,
      },
    });
    readMessagesViaZeroMock.mockResolvedValue(null);
    readMessagesMock.mockResolvedValue({
      messages: [
        {
          id: "m-1",
          sender: { name: "Alice", id: "u-a" },
          content: "hi",
          timestamp: 1,
        },
      ],
    });

    await buildProgram().parseAsync(["read", "Alice", "--limit", "10"], {
      from: "user",
    });

    expect(resolveDmMock).toHaveBeenCalledWith({
      recipient_name: "Alice",
      recipient_email: undefined,
      user_id: undefined,
      workspace_id: "ws-auth",
    });
    expect(readMessagesMock).toHaveBeenCalledWith({
      channel_id: "ch-dm",
      limit: 10,
    });
    expect(outputMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: [{ sender: "Alice", content: "hi", timestamp: 1 }],
      }),
    );
  });

  it("uses Zero for message reads after server resolution", async () => {
    resolveDmMock.mockResolvedValue({
      channel: {
        channel_id: "ch-dm",
        channel_type: "dm",
        participant_names: ["Bob"],
        participants: [],
        last_message_at: null,
        unread_count: 0,
      },
    });
    readMessagesViaZeroMock.mockResolvedValue({
      messages: [
        {
          id: "m-1",
          sender: { name: "Bob", id: "u-bob" },
          content: "zero hi",
          timestamp: 2,
        },
      ],
    });

    await buildProgram().parseAsync(["read", "--user-id", "u-bob"], {
      from: "user",
    });

    expect(resolveDmMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u-bob" }),
    );
    expect(readMessagesViaZeroMock).toHaveBeenCalledWith({
      channel_id: "ch-dm",
      limit: 25,
      timeout_ms: 100,
    });
    expect(readMessagesMock).not.toHaveBeenCalled();
  });

  it("falls back to REST message read when Zero misses", async () => {
    resolveDmMock.mockResolvedValue({
      channel: {
        channel_id: "ch-dm",
        channel_type: "dm",
        participant_names: ["Bob"],
        participants: [],
        last_message_at: null,
        unread_count: 0,
      },
    });
    readMessagesViaZeroMock.mockResolvedValue(null);
    readMessagesMock.mockResolvedValue({ messages: [] });

    await buildProgram().parseAsync(["read", "--user-id", "u-bob"], {
      from: "user",
    });

    expect(readMessagesMock).toHaveBeenCalledWith({
      channel_id: "ch-dm",
      limit: 25,
    });
  });

  it("supports group recipients using the same forms as dm send", async () => {
    resolveDmMock.mockResolvedValue({
      channel: {
        channel_id: "ch-g",
        channel_type: "group_dm",
        participant_names: ["Alice", "Bob"],
        participants: [],
        last_message_at: null,
        unread_count: 0,
      },
    });
    readMessagesViaZeroMock.mockResolvedValue({ messages: [] });

    await buildProgram().parseAsync(["read", "--to", "Alice,Bob"], {
      from: "user",
    });

    expect(resolveDmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient_names: ["Alice", "Bob"],
        user_ids: [],
        workspace_id: "ws-auth",
      }),
    );
  });

  it("rejects invalid limits as usage errors", async () => {
    await expect(
      buildProgram().parseAsync(["read", "Alice", "--limit", "101"], {
        from: "user",
      }),
    ).rejects.toThrow("__test_exit__");
    expect(outputErrorMock).toHaveBeenCalledWith(
      expect.anything(),
      "--limit must be an integer from 1 to 100.",
      1,
      undefined,
    );
  });

  it("rejects partial numeric limits", async () => {
    await expect(
      buildProgram().parseAsync(["read", "Alice", "--limit", "10abc"], {
        from: "user",
      }),
    ).rejects.toThrow("__test_exit__");
    expect(resolveDmMock).not.toHaveBeenCalled();
  });
});
