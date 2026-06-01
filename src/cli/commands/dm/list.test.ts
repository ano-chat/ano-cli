import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const listDmsMock = vi.fn();
const outputMock = vi.fn();
const outputErrorMock = vi.fn();

vi.mock("../../../core/api-client.js", () => ({
  createApiClient: () => ({ listDms: listDmsMock }),
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

const { formatDmRow, registerListDms } = await import("./list.js");

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerListDms(program);
  return program;
}

beforeEach(() => {
  listDmsMock.mockReset();
  outputMock.mockReset();
  outputErrorMock.mockReset();
  vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("__test_exit__");
  });
});

describe("ano dm list", () => {
  it("lists DMs through the read-only REST endpoint", async () => {
    listDmsMock.mockResolvedValue({
      dms: [
        {
          channel_id: "ch-1",
          channel_type: "dm",
          participant_names: ["Alice"],
          participants: [],
          last_message_at: "2026-05-31T12:00:00.000Z",
          unread_count: 2,
        },
      ],
    });

    await buildProgram().parseAsync(["list", "--limit", "10"], {
      from: "user",
    });

    expect(listDmsMock).toHaveBeenCalledWith({
      workspace_id: "ws-auth",
      limit: 10,
    });
    expect(outputMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: [
          expect.objectContaining({
            channel_id: "ch-1",
            participants: "Alice",
            unread_count: 2,
          }),
        ],
      }),
    );
  });

  it("uses the default limit", async () => {
    listDmsMock.mockResolvedValue({ dms: [] });

    await buildProgram().parseAsync(["list"], { from: "user" });

    expect(listDmsMock).toHaveBeenCalledWith({
      workspace_id: "ws-auth",
      limit: 50,
    });
  });

  it("rejects invalid limits as usage errors", async () => {
    await expect(
      buildProgram().parseAsync(["list", "--limit", "0"], { from: "user" }),
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
      buildProgram().parseAsync(["list", "--limit", "10abc"], {
        from: "user",
      }),
    ).rejects.toThrow("__test_exit__");
    expect(listDmsMock).not.toHaveBeenCalled();
  });
});

describe("formatDmRow", () => {
  it("uses Notes for self-DMs with no other participants", () => {
    expect(
      formatDmRow({
        channel_id: "ch-self",
        channel_type: "dm",
        participant_names: [],
        participants: [],
        last_message_at: null,
      }),
    ).toMatchObject({ participants: "Notes", unread_count: 0 });
  });
});
