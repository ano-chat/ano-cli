import { Command } from "commander";
import { registerEditAutomation } from "./automation.js";

/**
 * Top-level `edit` group — `ano edit <thing> <id>` for "modify
 * something interactively, guided by Claude Code." Today that's just
 * `ano edit automation <id>`.
 */
export function registerEdit(parent: Command): void {
  const group = new Command("edit").description(
    "Edit something interactively (guided by Claude Code)",
  );
  registerEditAutomation(group);
  parent.addCommand(group);
}
