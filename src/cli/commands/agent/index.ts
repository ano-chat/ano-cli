import type { Command } from "commander";
import { registerAgentContext } from "./context.js";
import { registerAgentStdio } from "./stdio.js";

export function registerAgent(parent: Command): void {
  const group = parent
    .command("agent")
    .description("Agent-optimized commands and protocols");

  registerAgentContext(group);
  registerAgentStdio(group);
}
