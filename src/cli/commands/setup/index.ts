import { Command } from "commander";
import { registerSetupAgentSkill } from "./agent-skill.js";
import { registerSetupHermes, registerSetupOpenClaw } from "./openclaw.js";

export function registerSetup(parent: Command): void {
  const group = new Command("setup").description(
    "Set up integrations with AI agents",
  );
  registerSetupAgentSkill(group, "claude");
  registerSetupAgentSkill(group, "codex");
  registerSetupOpenClaw(group);
  registerSetupHermes(group);
  parent.addCommand(group);
}
