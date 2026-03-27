import { describe, it, expect, vi, afterEach } from "vitest";
import { Command } from "commander";

// We cannot directly import extractCommandMeta since it's not exported.
// Instead, we test handleAgentHelp by capturing its stdout output and
// mocking process.exit to prevent it from terminating.

import { handleAgentHelp } from "../../src/cli/middleware/agent-help.js";

function buildTestProgram(): Command {
  const program = new Command("ano").description("Ano CLI");

  const channels = program
    .command("channels")
    .description("Manage channels");

  channels
    .command("list")
    .description("List channels in a workspace")
    .argument("[workspace]", "Workspace name or ID")
    .option("-l, --limit <n>", "Max results", "50")
    .option("--archived", "Include archived channels");

  program.command("doctor").description("Check CLI health");

  return program;
}

describe("handleAgentHelp", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const originalArgv = process.argv;

  afterEach(() => {
    stdoutSpy?.mockRestore();
    exitSpy?.mockRestore();
    process.argv = originalArgv;
  });

  function captureAgentHelp(args: string[]): Record<string, unknown> {
    const chunks: string[] = [];
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        chunks.push(String(chunk));
        return true;
      });
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      // no-op, prevent exit
    }) as never);

    process.argv = ["node", "ano", ...args, "--help", "--agent"];

    const program = buildTestProgram();
    handleAgentHelp(program);

    return JSON.parse(chunks.join(""));
  }

  it("extracts root command meta", () => {
    const meta = captureAgentHelp([]);

    expect(meta.command).toBe("ano");
    expect(meta.path).toEqual(["ano"]);
    expect(meta.description).toBe("Ano CLI");
    expect(Array.isArray(meta.subcommands)).toBe(true);
    const subs = meta.subcommands as Array<{ name: string }>;
    expect(subs.some((s) => s.name === "channels")).toBe(true);
    expect(subs.some((s) => s.name === "doctor")).toBe(true);
  });

  it("extracts subcommand meta for 'channels list'", () => {
    const meta = captureAgentHelp(["channels", "list"]);

    expect(meta.command).toBe("ano channels list");
    expect(meta.path).toEqual(["ano", "channels", "list"]);
    expect(meta.description).toBe("List channels in a workspace");

    const args = meta.args as Array<{ name: string; required: boolean }>;
    expect(args).toHaveLength(1);
    expect(args[0].name).toBe("workspace");
    expect(args[0].required).toBe(false);

    const flags = meta.flags as Array<{
      name: string;
      short?: string;
      type: string;
    }>;
    const limitFlag = flags.find((f) => f.name === "limit");
    expect(limitFlag).toBeDefined();
    expect(limitFlag!.short).toBe("l");
    expect(limitFlag!.type).toBe("string");

    const archivedFlag = flags.find((f) => f.name === "archived");
    expect(archivedFlag).toBeDefined();
    expect(archivedFlag!.type).toBe("boolean");
  });

  it("falls back to parent when subcommand not found", () => {
    const meta = captureAgentHelp(["nonexistent"]);

    // Should stay at root since "nonexistent" is not a command
    expect(meta.command).toBe("ano");
  });

  it("extracts middle-level group command", () => {
    const meta = captureAgentHelp(["channels"]);

    expect(meta.command).toBe("ano channels");
    expect(meta.description).toBe("Manage channels");
    const subs = meta.subcommands as Array<{ name: string; path: string }>;
    expect(subs.some((s) => s.name === "list")).toBe(true);
    expect(subs.find((s) => s.name === "list")!.path).toBe(
      "ano channels list",
    );
  });

  it("calls process.exit(0)", () => {
    captureAgentHelp([]);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("filters out --help from subcommands", () => {
    const meta = captureAgentHelp([]);
    const subs = meta.subcommands as Array<{ name: string }>;
    expect(subs.some((s) => s.name === "help")).toBe(false);
  });
});
