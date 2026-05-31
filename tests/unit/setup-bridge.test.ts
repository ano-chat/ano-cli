import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const contextMock = vi.hoisted(() => vi.fn());
const resolveAuthMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/core/auth.js", () => ({
  resolveAuth: resolveAuthMock,
}));

vi.mock("../../src/core/api-client.js", () => ({
  createApiClient: () => ({ context: contextMock }),
}));

const { registerSetup } = await import("../../src/cli/commands/setup/index.js");

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program
    .option("--key <key>")
    .option("--endpoint <url>", "API endpoint", "https://api.ano.dev");
  registerSetup(program);
  return program;
}

function renderedOutput(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((args) => args.join(" ")).join("\n");
}

beforeEach(() => {
  resolveAuthMock.mockReset();
  resolveAuthMock.mockReturnValue({
    key: "ano_cwk_abcdefghijklmnop",
    endpoint: "https://api.ano.dev",
    source: "flag",
  });
  contextMock.mockReset();
  contextMock.mockResolvedValue({
    user: { name: "Ada" },
    workspace: { name: "Acme" },
  });
});

describe("setup bridge commands", () => {
  it("keeps OpenClaw on the default bridge agent", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let output = "";
    try {
      await buildProgram().parseAsync([
        "node",
        "ano",
        "--key",
        "ano_cwk_abcdefghijklmnop",
        "setup",
        "openclaw",
        "--openclaw-url",
        "https://openclaw.example",
        "--openclaw-token",
        "secret",
        "--health-port",
        "9444",
      ]);
      output = renderedOutput(log);
    } finally {
      log.mockRestore();
    }

    expect(output).toContain("--openclaw https://openclaw.example");
    expect(output).toContain("--openclaw-token <token>");
    expect(output).toContain("--health-port 9444");
    expect(output).toContain(
      "ano connect install-service --key <key> --openclaw https://openclaw.example --openclaw-token <token>",
    );
    expect(output).not.toContain("--openclaw-agent");
  });

  it("maps Hermes setup flags to the existing bridge runtime flags", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let output = "";
    try {
      await buildProgram().parseAsync([
        "node",
        "ano",
        "--key",
        "ano_cwk_abcdefghijklmnop",
        "setup",
        "hermes",
        "--hermes-url",
        "https://hermes.example",
        "--hermes-token",
        "secret",
      ]);
      output = renderedOutput(log);
    } finally {
      log.mockRestore();
    }

    expect(output).toContain("--openclaw https://hermes.example");
    expect(output).toContain("--openclaw-token <token>");
    expect(output).toContain("--openclaw-agent hermes");
    expect(output).toContain(
      "ano connect install-service --key <key> --openclaw https://hermes.example --openclaw-token <token> --openclaw-agent hermes",
    );
    expect(output).not.toContain("--hermes-url");
  });
});
