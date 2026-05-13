/**
 * Tests for the `ano dm send` command's recipient handling.
 *
 * The interesting logic is the input normaliser (repeated --to flags
 * AND comma-separated AND variadic, all collapsed to one deduped
 * list) and the 1:1 vs group dispatch decision. The api-client call
 * itself is a thin pass-through and is covered server-side.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Command } from "commander";

const sendDmMock = vi.fn();
const resolveAuthMock = vi.fn(() => ({
  key: "k",
  endpoint: "http://x",
  source: "flag",
}));

vi.mock("../../src/core/api-client.js", () => ({
  createApiClient: () => ({ sendDm: sendDmMock }),
}));
vi.mock("../../src/core/auth.js", () => ({
  resolveAuth: resolveAuthMock,
}));
const outputErrorMock = vi.fn();
vi.mock("../../src/core/output.js", () => ({
  output: vi.fn(),
  outputError: outputErrorMock,
}));

const { registerSendDm } = await import("../../src/cli/commands/dm/send.js");

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride(); // throw instead of process.exit on parse error
  registerSendDm(program);
  return program;
}

beforeEach(() => {
  sendDmMock.mockReset();
  outputErrorMock.mockReset();
  // The CLI's error-handler middleware calls process.exit(); stub it
  // out so tests can inspect the captured outputError args instead.
  vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("__test_exit__");
  });
  sendDmMock.mockResolvedValue({
    ok: true,
    message_id: "m",
    channel_id: "ch",
    recipient: "Alice",
  });
});

describe("ano dm send — recipient parsing", () => {
  it("single --to routes to 1:1 sendDm", async () => {
    const program = buildProgram();
    await program.parseAsync(["send", "hi", "--to", "Alice"], {
      from: "user",
    });
    expect(sendDmMock).toHaveBeenCalledTimes(1);
    const call = sendDmMock.mock.calls[0][0];
    expect(call.recipient_name).toBe("Alice");
    expect(call.recipient_names).toBeUndefined();
  });

  it("two --to flags route to group DM", async () => {
    const program = buildProgram();
    sendDmMock.mockResolvedValueOnce({
      ok: true,
      message_id: "m",
      channel_id: "ch",
      recipients: ["Alice", "Bob"],
      channel_type: "group_dm",
    });
    await program.parseAsync(["send", "hi", "--to", "Alice", "--to", "Bob"], {
      from: "user",
    });
    const call = sendDmMock.mock.calls[0][0];
    expect(call.recipient_names).toEqual(["Alice", "Bob"]);
    expect(call.recipient_name).toBeUndefined();
  });

  it("variadic --to Alice Bob routes to group DM", async () => {
    const program = buildProgram();
    sendDmMock.mockResolvedValueOnce({
      ok: true,
      message_id: "m",
      channel_id: "ch",
      recipients: ["Alice", "Bob"],
      channel_type: "group_dm",
    });
    await program.parseAsync(["send", "hi", "--to", "Alice", "Bob"], {
      from: "user",
    });
    expect(sendDmMock).toHaveBeenCalledWith(
      expect.objectContaining({ recipient_names: ["Alice", "Bob"] }),
    );
  });

  it("comma-separated --to Alice,Bob routes to group DM", async () => {
    const program = buildProgram();
    sendDmMock.mockResolvedValueOnce({
      ok: true,
      message_id: "m",
      channel_id: "ch",
      recipients: ["Alice", "Bob"],
      channel_type: "group_dm",
    });
    await program.parseAsync(["send", "hi", "--to", "Alice,Bob"], {
      from: "user",
    });
    expect(sendDmMock).toHaveBeenCalledWith(
      expect.objectContaining({ recipient_names: ["Alice", "Bob"] }),
    );
  });

  it("dedupes repeated names across forms", async () => {
    const program = buildProgram();
    sendDmMock.mockResolvedValueOnce({
      ok: true,
      message_id: "m",
      channel_id: "ch",
      recipients: ["Alice", "Bob"],
      channel_type: "group_dm",
    });
    await program.parseAsync(
      ["send", "hi", "--to", "Alice,Bob", "--to", "Alice"],
      { from: "user" },
    );
    expect(sendDmMock).toHaveBeenCalledWith(
      expect.objectContaining({ recipient_names: ["Alice", "Bob"] }),
    );
  });

  it("mixes --to and --user-id, routes to group when total ≥2", async () => {
    const program = buildProgram();
    sendDmMock.mockResolvedValueOnce({
      ok: true,
      message_id: "m",
      channel_id: "ch",
      recipients: ["Alice", "Bob"],
      channel_type: "group_dm",
    });
    await program.parseAsync(
      ["send", "hi", "--to", "Alice", "--user-id", "u-bob"],
      { from: "user" },
    );
    expect(sendDmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient_names: ["Alice"],
        user_ids: ["u-bob"],
      }),
    );
  });

  it("rejects when no recipient flags are provided", async () => {
    const program = buildProgram();
    await expect(
      program.parseAsync(["send", "hi"], { from: "user" }),
    ).rejects.toThrow("__test_exit__");
    expect(sendDmMock).not.toHaveBeenCalled();
    expect(outputErrorMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/At least one of --to/),
      expect.anything(),
    );
  });

  it("rejects --email + group recipients (1:1-only)", async () => {
    const program = buildProgram();
    await expect(
      program.parseAsync(["send", "hi", "--email", "a@b.co", "--to", "Bob"], {
        from: "user",
      }),
    ).rejects.toThrow("__test_exit__");
    expect(sendDmMock).not.toHaveBeenCalled();
    expect(outputErrorMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/--email is only supported for 1:1/),
      expect.anything(),
    );
  });
});
