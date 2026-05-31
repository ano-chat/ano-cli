import { describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION } from "../../src/daemon/protocol.js";
import { handleAgentStdioRequest } from "../../src/cli/commands/agent/stdio-runtime.js";

describe("agent stdio protocol", () => {
  it("responds to ping without dispatching a CLI command", async () => {
    const dispatch = vi.fn();
    const resp = await handleAgentStdioRequest(
      { method: "ping", id: 1, v: PROTOCOL_VERSION },
      dispatch,
    );

    expect(resp).toMatchObject({
      id: 1,
      ok: true,
      pong: true,
      v: PROTOCOL_VERSION,
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches exec requests with cwd and env", async () => {
    const dispatch = vi.fn().mockResolvedValue({
      stdout: '{"ok":true}\n',
      stderr: "",
      exitCode: 0,
    });

    const resp = await handleAgentStdioRequest(
      {
        method: "exec",
        id: 2,
        v: PROTOCOL_VERSION,
        argv: ["channels", "list", "--agent"],
        cwd: "/tmp/project",
        env: { ANO_WORKSPACE_ID: "ws-1", IGNORED: 123 },
      },
      dispatch,
    );

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "exec",
        id: 2,
        argv: ["channels", "list", "--agent"],
        cwd: "/tmp/project",
        env: { ANO_WORKSPACE_ID: "ws-1" },
      }),
    );
    expect(resp).toMatchObject({
      id: 2,
      ok: true,
      stdout: '{"ok":true}\n',
      stderr: "",
      exitCode: 0,
    });
  });

  it("rejects exec requests without machine-readable output flags", async () => {
    const dispatch = vi.fn();
    const resp = await handleAgentStdioRequest(
      {
        method: "exec",
        id: 9,
        v: PROTOCOL_VERSION,
        argv: ["channels", "list"],
      },
      dispatch,
    );

    expect(resp).toMatchObject({
      id: 9,
      ok: false,
      code: "machine_output_required",
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects commands that would consume the stdio protocol stream", async () => {
    const dispatch = vi.fn();
    const resp = await handleAgentStdioRequest(
      {
        method: "exec",
        id: 3,
        v: PROTOCOL_VERSION,
        argv: ["messages", "send", "--file", "-", "--agent"],
      },
      dispatch,
    );

    expect(resp).toMatchObject({
      id: 3,
      ok: false,
      code: "stdin_unsupported",
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects unknown methods instead of treating them as exec", async () => {
    const dispatch = vi.fn();
    const resp = await handleAgentStdioRequest(
      {
        method: "wat",
        id: 4,
        v: PROTOCOL_VERSION,
        argv: ["channels", "list", "--agent"],
      },
      dispatch,
    );

    expect(resp).toMatchObject({
      id: 4,
      ok: false,
      code: "unknown_method",
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects non-string argv entries instead of dropping them", async () => {
    const dispatch = vi.fn();
    const resp = await handleAgentStdioRequest(
      {
        method: "exec",
        id: 5,
        v: PROTOCOL_VERSION,
        argv: ["messages", "send", 123, "--agent"],
      },
      dispatch,
    );

    expect(resp).toMatchObject({
      id: 5,
      ok: false,
      code: "unknown_method",
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects recursive agent stdio", async () => {
    const dispatch = vi.fn();
    const resp = await handleAgentStdioRequest(
      {
        method: "exec",
        id: 6,
        v: PROTOCOL_VERSION,
        argv: ["--json", "agent", "stdio"],
      },
      dispatch,
    );

    expect(resp).toMatchObject({
      id: 6,
      ok: false,
      code: "unknown_method",
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects long-running commands even when global options have values", async () => {
    const dispatch = vi.fn();
    const resp = await handleAgentStdioRequest(
      {
        method: "exec",
        id: 60,
        v: PROTOCOL_VERSION,
        argv: ["--endpoint", "https://api.example", "agent", "stdio", "--json"],
      },
      dispatch,
    );

    expect(resp).toMatchObject({
      id: 60,
      ok: false,
      code: "unknown_method",
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects daemon serve because it would never return", async () => {
    const dispatch = vi.fn();
    const resp = await handleAgentStdioRequest(
      {
        method: "exec",
        id: 7,
        v: PROTOCOL_VERSION,
        argv: ["daemon", "serve"],
      },
      dispatch,
    );

    expect(resp).toMatchObject({
      id: 7,
      ok: false,
      code: "unknown_method",
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("keeps dispatch failures inside the protocol response", async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error("boom"));
    const resp = await handleAgentStdioRequest(
      {
        method: "exec",
        id: 8,
        v: PROTOCOL_VERSION,
        argv: ["channels", "list", "--agent"],
      },
      dispatch,
    );

    expect(resp).toMatchObject({
      id: 8,
      ok: false,
      code: "internal",
      error: "boom",
    });
  });
});
