import { Command } from "commander";
import { registerSetupClaude } from "./claude.js";
import { registerSetupOpenClaw } from "./openclaw.js";

export function registerSetup(parent: Command): void {
  const group = new Command("setup").description(
    "Set up integrations with AI agents",
  );
  registerSetupClaude(group);
  registerSetupOpenClaw(group);
  parent.addCommand(group);
}
