import { Command } from "commander";
import { registerNewAutomation } from "./automation.js";

/**
 * Top-level `new` group — `ano new <thing>` for "create something
 * interactively, guided by Claude Code." Today that's just
 * `ano new automation`; future entries (e.g. `ano new connection`,
 * `ano new coworker`) follow the same shape: thin CLI wrappers that
 * spawn `claude` with a topical bootstrap prompt.
 */
export function registerNew(parent: Command): void {
  const group = new Command("new").description(
    "Create something interactively (guided by Claude Code)",
  );
  registerNewAutomation(group);
  parent.addCommand(group);
}
