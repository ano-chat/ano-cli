import type { Command } from "commander";
import { registerAgentContext } from "./context.js";
import { registerAgentRoutes } from "./routes.js";
import { registerAgentStdio } from "./stdio.js";

export function registerAgent(parent: Command): void {
  const group = parent
    .command("agent")
    .description("Agent-optimized commands and protocols");

  registerAgentContext(group);
  registerAgentRoutes(group);
  registerAgentStdio(group);
}
