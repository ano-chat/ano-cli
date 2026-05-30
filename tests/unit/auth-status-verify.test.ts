import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

const contextMock = vi.fn();
const resolveAuthMock = vi.fn();
const outputMock = vi.fn();

vi.mock("../../src/core/auth.js", () => ({
  resolveAuth: resolveAuthMock,
}));
vi.mock("../../src/core/api-client.js", () => ({
  createApiClient: () => ({ context: contextMock }),
}));
vi.mock("../../src/core/output.js", () => ({
  output: outputMock,
  outputError: vi.fn(),
}));

const { registerAuthStatus } =
  await import("../../src/cli/commands/auth/status.js");

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  const auth = program.command("auth");
  registerAuthStatus(auth);
  return program;
}

function lastData(): Record<string, unknown> {
  return outputMock.mock.calls.at(-1)![1].data as Record<string, unknown>;
}

const VALID_AUTH = {
  key: "ano_usr_abcdef123456",
  endpoint: "https://api-us.ano.dev",
  source: "global" as const,
};

describe("ano auth status --verify", () => {
  beforeEach(() => {
    contextMock.mockReset();
    resolveAuthMock.mockReset();
    outputMock.mockReset();
    resolveAuthMock.mockReturnValue(VALID_AUTH);
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("without --verify: reports key present but UNVERIFIED, makes no API call", async () => {
    await buildProgram().parseAsync(["auth", "status"], { from: "user" });
    const data = lastData();
    expect(data.authenticated).toBe(true);
    expect(data.key_present).toBe(true);
    expect(data.verified).toBe(false);
    expect(contextMock).not.toHaveBeenCalled();
  });

  it("--verify with a VALID key: key_valid=true, surfaces user+workspace", async () => {
    contextMock.mockResolvedValue({
      user: { id: "u-1", name: "Ruben" },
      workspace: { id: "ws-1", name: "Ano", member_count: 2 },
      channels: [],
    });
    await buildProgram().parseAsync(["auth", "status", "--verify"], {
      from: "user",
    });
    const data = lastData();
    expect(data.key_valid).toBe(true);
    expect(data.verified).toBe(true);
    expect((data.workspace as { name: string }).name).toBe("Ano");
    expect(contextMock).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it("--verify with an EXPIRED key: key_valid=false + exit code 3 (the false-positive this fixes)", async () => {
    contextMock.mockRejectedValue(new Error("Invalid or expired API key"));
    await buildProgram().parseAsync(["auth", "status", "--verify"], {
      from: "user",
    });
    const data = lastData();
    expect(data.authenticated).toBe(false);
    expect(data.key_present).toBe(true);
    expect(data.key_valid).toBe(false);
    expect(data.error).toContain("expired");
    expect(process.exitCode).toBe(3);
  });

  it("no key at all: authenticated=false, key_present=false", async () => {
    resolveAuthMock.mockImplementation(() => {
      throw new Error("No API key found");
    });
    await buildProgram().parseAsync(["auth", "status"], { from: "user" });
    const data = lastData();
    expect(data.authenticated).toBe(false);
    expect(data.key_present).toBe(false);
  });
});
