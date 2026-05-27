/**
 * Tests for `ano channels list --unread`. The interesting bits are:
 *   - The flag is plumbed through to the api-client as `unread: true`.
 *   - The Zero fast-path is bypassed when `--unread` is set (Zero's
 *     replica doesn't carry per-user read state).
 *   - Without the flag, the default path is unchanged: Zero fast-path
 *     attempts first, then falls back to REST without `unread`.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Command } from "commander";

const listChannelsMock = vi.fn();
const listChannelsViaZeroMock = vi.fn();
const outputMock = vi.fn();
const resolveAuthMock = vi.fn(() => ({
  key: "k",
  endpoint: "http://x",
  source: "flag",
}));

vi.mock("../../src/core/api-client.js", () => ({
  createApiClient: () => ({ listChannels: listChannelsMock }),
}));
vi.mock("../../src/core/auth.js", () => ({
  resolveAuth: resolveAuthMock,
}));
vi.mock("../../src/zero/reads.js", () => ({
  listChannelsViaZero: listChannelsViaZeroMock,
}));
vi.mock("../../src/core/output.js", () => ({
  output: outputMock,
  outputError: vi.fn(),
}));

const { registerListChannels } =
  await import("../../src/cli/commands/channels/list.js");

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerListChannels(program);
  return program;
}

beforeEach(() => {
  listChannelsMock.mockReset();
  listChannelsViaZeroMock.mockReset();
  outputMock.mockReset();
  listChannelsMock.mockResolvedValue({ channels: [] });
  listChannelsViaZeroMock.mockResolvedValue(null);
});

describe("ano channels list --unread", () => {
  it("passes `unread: true` to the api-client", async () => {
    await buildProgram().parseAsync(["node", "ano", "list", "--unread"]);
    expect(listChannelsMock).toHaveBeenCalledWith(
      expect.objectContaining({ unread: true }),
    );
  });

  it("bypasses the Zero fast-path when --unread is set", async () => {
    await buildProgram().parseAsync(["node", "ano", "list", "--unread"]);
    expect(listChannelsViaZeroMock).not.toHaveBeenCalled();
    expect(listChannelsMock).toHaveBeenCalledOnce();
  });

  it("does NOT add `unread` to the api-client body when the flag is absent", async () => {
    await buildProgram().parseAsync(["node", "ano", "list"]);
    const callArg = listChannelsMock.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect("unread" in callArg).toBe(false);
  });

  it("uses Zero fast-path first when --unread is absent", async () => {
    listChannelsViaZeroMock.mockResolvedValue({
      channels: [{ id: "ch-1", name: "general", type: "channel" }],
    });
    await buildProgram().parseAsync(["node", "ano", "list"]);
    expect(listChannelsViaZeroMock).toHaveBeenCalledOnce();
    expect(listChannelsMock).not.toHaveBeenCalled();
  });

  it("falls through to REST when Zero returns null (no replica)", async () => {
    listChannelsViaZeroMock.mockResolvedValue(null);
    await buildProgram().parseAsync(["node", "ano", "list"]);
    expect(listChannelsViaZeroMock).toHaveBeenCalledOnce();
    expect(listChannelsMock).toHaveBeenCalledOnce();
  });

  it("selects the unread-shape columns when --unread is set", async () => {
    await buildProgram().parseAsync(["node", "ano", "list", "--unread"]);
    const outputArg = outputMock.mock.calls[0]?.[1] as {
      columns?: string[];
      title?: string;
    };
    expect(outputArg.columns).toEqual([
      "id",
      "name",
      "unread_count",
      "last_message_at",
      "last_read_at",
      "topic",
    ]);
    expect(outputArg.title).toBe("Unread channels");
  });

  it("selects the default columns without --unread", async () => {
    await buildProgram().parseAsync(["node", "ano", "list"]);
    const outputArg = outputMock.mock.calls[0]?.[1] as {
      columns?: string[];
      title?: string;
    };
    expect(outputArg.columns).toEqual(["id", "name", "type", "topic"]);
    expect(outputArg.title).toBe("Channels");
  });
});
