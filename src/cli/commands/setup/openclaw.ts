import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { green, dim } from "../../../util/colors.js";

interface BridgeOptions {
  url?: string;
  token?: string;
  agent: string;
  healthPort?: number;
}

export function registerSetupOpenClaw(parent: Command): void {
  parent
    .command("openclaw")
    .description("Configure OpenClaw integration with Ano")
    .option("--openclaw-url <url>", "OpenClaw gateway URL")
    .option("--openclaw-token <token>", "OpenClaw auth token")
    .option("--health-port <port>", "Health server port", parseInt)
    .action(
      withErrorHandler(async (opts, cmd) => {
        await printBridgeSetup(cmd, {
          url: opts.openclawUrl,
          token: opts.openclawToken,
          agent: "main",
          healthPort: opts.healthPort,
        });
      }),
    );
}

export function registerSetupHermes(parent: Command): void {
  parent
    .command("hermes")
    .description("Configure Hermes Agent integration with Ano")
    .option("--hermes-url <url>", "Hermes Agent gateway URL")
    .option("--hermes-token <token>", "Hermes Agent auth token")
    .option("--health-port <port>", "Health server port", parseInt)
    .action(
      withErrorHandler(async (opts, cmd) => {
        await printBridgeSetup(cmd, {
          url: opts.hermesUrl,
          token: opts.hermesToken,
          agent: "hermes",
          healthPort: opts.healthPort,
        });
      }),
    );
}

async function printBridgeSetup(
  cmd: Command,
  options: BridgeOptions,
): Promise<void> {
  const globals = cmd.optsWithGlobals() as GlobalOptions;
  const auth = resolveAuth(globals);
  const client = createApiClient(auth);
  const ctx = await client.context();

  console.log(
    `${green("Connected")} to ${ctx.workspace.name} as ${ctx.user.name}`,
  );
  console.log();

  const parts = ["ano connect", `--key ${auth.key.slice(0, 12)}...`];
  if (auth.endpoint !== "https://api.ano.dev") {
    parts.push(`--endpoint ${auth.endpoint}`);
  }
  appendBridgeFlags(parts, options);

  console.log(`To start the agent bridge:`);
  console.log(`  ${dim(parts.join(" \\\n    "))}`);
  console.log();
  console.log(`To install as a persistent service:`);
  console.log(`  ${dim(buildInstallCommand(options))}`);
  console.log();
  console.log(`To verify:`);
  console.log(`  ${dim("ano doctor")}`);
}

function appendBridgeFlags(parts: string[], options: BridgeOptions): void {
  if (options.url) parts.push(`--openclaw ${options.url}`);
  if (options.token) parts.push("--openclaw-token <token>");
  if (options.agent !== "main") parts.push(`--openclaw-agent ${options.agent}`);
  if (options.healthPort) parts.push(`--health-port ${options.healthPort}`);
}

function buildInstallCommand(options: BridgeOptions): string {
  const parts = [
    "ano connect install-service",
    "--key <key>",
    `--openclaw ${options.url ?? "<url>"}`,
  ];
  if (options.token) parts.push("--openclaw-token <token>");
  if (options.agent !== "main") {
    parts.push("--openclaw-agent", options.agent);
  }
  return parts.join(" ");
}
