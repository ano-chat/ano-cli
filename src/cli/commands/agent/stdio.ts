import type { Command } from "commander";

export function registerAgentStdio(parent: Command): void {
  parent
    .command("stdio")
    .description("Run a persistent newline-JSON command server on stdin/stdout")
    .action(async () => {
      const { runAgentStdio } = await import("./stdio-runtime.js");
      await runAgentStdio();
    });
}
