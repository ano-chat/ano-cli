import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression: `ano messages send --channel-name <n> --workspace <id>` MUST
 * forward `workspace_id` into the server-side name resolution. Channel names
 * are NOT unique across the workspaces a key can see (prod has two #general),
 * so an unscoped `--channel-name` resolves the earliest-created match across
 * ALL memberships — a wrong-tenant send. The root `--workspace` flag carries
 * the scope; this test locks in that it reaches `client.sendMessage`.
 */

const sendMessageMock = vi.fn(async () => ({
  message_id: "m-1",
  channel_id: "c-1",
}));

vi.mock("../../src/core/api-client.js", () => ({
  createApiClient: () => ({ sendMessage: sendMessageMock }),
}));

vi.mock("../../src/core/auth.js", () => ({
  resolveAuth: () => ({
    key: "ano_usr_test",
    endpoint: "https://api-us.ano.dev",
    source: "flag",
  }),
}));

// Force the REST path (not the Zero fast-path) so sendMessage is exercised.
// The Zero path is gated on `!opts.channelName`, so any channel-name send
// already routes through REST — but stub writes to be safe/hermetic.
vi.mock("../../src/zero/writes.js", () => ({
  sendTextMessageViaZero: vi.fn(async () => null),
}));

import { Command } from "commander";
import { registerSendMessage } from "../../src/cli/commands/messages/send.js";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  // Mirror the root global flag the real CLI declares (src/cli/root.ts).
  program.option("-w, --workspace <id>", "Workspace ID");
  const messages = program.command("messages");
  registerSendMessage(messages);
  return program;
}

describe("messages send — workspace scoping for channel-name resolution", () => {
  beforeEach(() => {
    sendMessageMock.mockClear();
  });

  it("forwards --workspace as workspace_id when resolving --channel-name", async () => {
    const program = buildProgram();
    // Global `--workspace` is a ROOT option — it must precede the
    // subcommand (`ano --workspace <id> messages send ...`), the same
    // position the real CLI requires for root flags.
    await program.parseAsync(
      [
        "--workspace",
        "ws-123",
        "messages",
        "send",
        "--channel-name",
        "general",
        "hello",
      ],
      { from: "user" },
    );

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const payload = sendMessageMock.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(payload.channel_name).toBe("general");
    expect(payload.workspace_id).toBe("ws-123");
    expect(payload.content).toBe("hello");
  });

  it("leaves workspace_id undefined when --workspace is omitted", async () => {
    const program = buildProgram();
    await program.parseAsync(
      ["messages", "send", "--channel-name", "general", "hello"],
      { from: "user" },
    );

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const payload = sendMessageMock.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(payload.workspace_id).toBeUndefined();
  });
});
