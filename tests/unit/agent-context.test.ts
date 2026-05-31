import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const contextMock = vi.fn();
const listTablesMock = vi.fn();
const outputMock = vi.fn();
const listChannelsViaZeroMock = vi.fn();
const listUsersViaZeroMock = vi.fn();
const activeZeroOrNullMock = vi.fn();
const resolveAuthMock = vi.fn();

vi.mock("../../src/core/auth.js", () => ({
  resolveAuth: resolveAuthMock,
}));

vi.mock("../../src/core/api-client.js", () => ({
  createApiClient: () => ({
    context: contextMock,
    listTables: listTablesMock,
  }),
}));

vi.mock("../../src/core/output.js", () => ({
  output: outputMock,
  outputError: vi.fn(),
}));

vi.mock("../../src/zero/active-client.js", () => ({
  activeZeroOrNull: activeZeroOrNullMock,
}));

vi.mock("../../src/zero/reads.js", () => ({
  listChannelsViaZero: listChannelsViaZeroMock,
  listUsersViaZero: listUsersViaZeroMock,
}));

const { registerAgent } = await import("../../src/cli/commands/agent/index.js");

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option("-w, --workspace <id>");
  program.option("-j, --json");
  program.option("--agent");
  registerAgent(program);
  return program;
}

const contextPayload = {
  user: { id: "u-self", name: "Operator", role: "admin", is_coworker: false },
  workspace: { id: "ws-context", name: "Ano", member_count: 2 },
  channels: [
    {
      id: "ctx-ch",
      name: "general",
      type: "channel",
      workspace_id: "ws-1",
    },
  ],
  members: [
    {
      id: "ctx-user",
      display_name: "Context User",
      email: "ctx@example.com",
    },
  ],
};

beforeEach(() => {
  contextMock.mockReset();
  listTablesMock.mockReset();
  outputMock.mockReset();
  listChannelsViaZeroMock.mockReset();
  listUsersViaZeroMock.mockReset();
  activeZeroOrNullMock.mockReset();
  resolveAuthMock.mockReset();
  resolveAuthMock.mockReturnValue({
    key: "k",
    endpoint: "http://x",
    source: "flag",
  });

  contextMock.mockResolvedValue(contextPayload);
  listTablesMock.mockResolvedValue([
    {
      id: "table-1",
      name: "Tasks",
      prefix: "TASK",
      field_definitions: [],
      item_count: 3,
    },
  ]);
  listChannelsViaZeroMock.mockResolvedValue(null);
  listUsersViaZeroMock.mockResolvedValue(null);
  activeZeroOrNullMock.mockReturnValue(null);
});

describe("ano agent context", () => {
  it("uses Zero-backed channels and users when available", async () => {
    listChannelsViaZeroMock.mockResolvedValue({
      channels: [
        {
          id: "zero-ch",
          name: "engineering",
          type: "channel",
          workspace_id: "ws-1",
        },
      ],
    });
    listUsersViaZeroMock.mockResolvedValue({
      users: [{ id: "zero-user", display_name: "Zero User" }],
    });
    activeZeroOrNullMock.mockReturnValue({});

    await buildProgram().parseAsync([
      "node",
      "ano",
      "-w",
      "ws-1",
      "agent",
      "context",
      "--json",
    ]);

    expect(contextMock).toHaveBeenCalledWith({ workspace_id: "ws-1" });
    expect(listTablesMock).toHaveBeenCalledWith({ workspace_id: "ws-1" });
    expect(listChannelsViaZeroMock).toHaveBeenCalledWith({
      workspace_id: "ws-1",
    });
    expect(listUsersViaZeroMock).toHaveBeenCalledWith({
      workspace_id: "ws-1",
    });

    const payload = outputMock.mock.calls[0]?.[1];
    expect(payload.data.channels).toEqual([
      {
        id: "zero-ch",
        name: "engineering",
        type: "channel",
        workspace_id: "ws-1",
      },
    ]);
    expect(payload.data.users).toEqual([
      { id: "zero-user", display_name: "Zero User" },
    ]);
    expect(payload.data.sources).toMatchObject({
      context: "rest",
      channels: "zero",
      users: "zero",
      tables: "rest",
    });
    expect(payload.data.fast_path.zero_available).toBe(true);
  });

  it("falls back to /context data without extra channel/user REST calls", async () => {
    await buildProgram().parseAsync([
      "node",
      "ano",
      "-w",
      "ws-1",
      "agent",
      "context",
      "--json",
    ]);

    const payload = outputMock.mock.calls[0]?.[1];
    expect(payload.data.channels).toEqual(contextPayload.channels);
    expect(payload.data.users).toEqual(contextPayload.members);
    expect(payload.data.sources).toMatchObject({
      channels: "context_rest",
      users: "context_rest",
    });
  });

  it("does not use Zero lists without an explicit workspace scope", async () => {
    await buildProgram().parseAsync([
      "node",
      "ano",
      "agent",
      "context",
      "--json",
    ]);

    expect(listChannelsViaZeroMock).not.toHaveBeenCalled();
    expect(listUsersViaZeroMock).not.toHaveBeenCalled();
    const payload = outputMock.mock.calls[0]?.[1];
    expect(payload.data.workspace_id).toBe("ws-context");
    expect(payload.data.channels).toEqual(contextPayload.channels);
  });

  it("uses a pinned profile workspace as the default Zero scope", async () => {
    resolveAuthMock.mockReturnValue({
      key: "k",
      endpoint: "http://x",
      source: "global",
      workspace_id: "ws-profile",
    });
    listChannelsViaZeroMock.mockResolvedValue({
      channels: [
        {
          id: "zero-ch",
          name: "engineering",
          type: "channel",
          workspace_id: "ws-profile",
        },
      ],
    });
    listUsersViaZeroMock.mockResolvedValue({
      users: [{ id: "zero-user", display_name: "Zero User" }],
    });

    await buildProgram().parseAsync([
      "node",
      "ano",
      "agent",
      "context",
      "--json",
    ]);

    expect(contextMock).toHaveBeenCalledWith({ workspace_id: "ws-profile" });
    expect(listChannelsViaZeroMock).toHaveBeenCalledWith({
      workspace_id: "ws-profile",
    });
    expect(listUsersViaZeroMock).toHaveBeenCalledWith({
      workspace_id: "ws-profile",
    });
    expect(listTablesMock).toHaveBeenCalledWith({
      workspace_id: "ws-profile",
    });
  });

  it("skips tables when requested", async () => {
    await buildProgram().parseAsync([
      "node",
      "ano",
      "-w",
      "ws-1",
      "agent",
      "context",
      "--no-tables",
      "--json",
    ]);

    expect(listTablesMock).not.toHaveBeenCalled();
    const payload = outputMock.mock.calls[0]?.[1];
    expect(payload.data.tables).toEqual([]);
    expect(payload.data.sources.tables).toBe("skipped");
  });
});
