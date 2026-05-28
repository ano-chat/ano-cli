/**
 * Regression guard for the `--file` arg-order footgun. `--file` used to
 * be variadic (`<paths...>`), which greedily swallowed the required
 * `<content>` positional when it came after `--file`, producing
 * "missing required argument 'content'". It's now a non-variadic
 * repeatable collector, so content parses correctly regardless of order.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Command } from "commander";

const sendMessageMock = vi.fn();
const uploadAttachmentsMock = vi.fn();

vi.mock("../../src/core/api-client.js", () => ({
  createApiClient: () => ({ sendMessage: sendMessageMock }),
}));
vi.mock("../../src/core/auth.js", () => ({
  resolveAuth: () => ({ key: "k", endpoint: "http://x", source: "flag" }),
}));
vi.mock("../../src/core/output.js", () => ({
  output: vi.fn(),
  outputError: vi.fn(),
}));
vi.mock("../../src/zero/writes.js", () => ({
  sendTextMessageViaZero: vi.fn(async () => null),
}));
// Keep the REAL collectFileArg + resolveFiles (the code under test);
// only stub the actual upload so no FS/network is touched.
vi.mock("../../src/cli/file-attachments.js", async (orig) => {
  const actual =
    await orig<typeof import("../../src/cli/file-attachments.js")>();
  return {
    ...actual,
    uploadAttachments: uploadAttachmentsMock,
  };
});

const { registerSendMessage } =
  await import("../../src/cli/commands/messages/send.js");

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerSendMessage(program);
  return program;
}

beforeEach(() => {
  sendMessageMock.mockReset();
  uploadAttachmentsMock.mockReset();
  sendMessageMock.mockResolvedValue({ id: "m1", channel_id: "ch1" });
  uploadAttachmentsMock.mockResolvedValue([{ id: "att-1" }]);
});

describe("ano messages send — --file arg order", () => {
  it("does NOT swallow content when --file comes BEFORE it", async () => {
    await buildProgram().parseAsync([
      "node",
      "ano",
      "send",
      "--file",
      "x.html",
      "the message body",
      "-c",
      "ch1",
    ]);
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ content: "the message body" }),
    );
    expect(uploadAttachmentsMock).toHaveBeenCalledOnce();
  });

  it("still works with content first", async () => {
    await buildProgram().parseAsync([
      "node",
      "ano",
      "send",
      "the message body",
      "--file",
      "x.html",
      "-c",
      "ch1",
    ]);
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ content: "the message body" }),
    );
  });

  it("accumulates repeated --file flags", async () => {
    await buildProgram().parseAsync([
      "node",
      "ano",
      "send",
      "msg",
      "--file",
      "a.html",
      "--file",
      "b.html",
      "-c",
      "ch1",
    ]);
    const [, filePaths] = uploadAttachmentsMock.mock.calls[0] ?? [];
    expect((filePaths as string[]).length).toBe(2);
    expect((filePaths as string[])[0]).toMatch(/a\.html$/);
    expect((filePaths as string[])[1]).toMatch(/b\.html$/);
  });
});
