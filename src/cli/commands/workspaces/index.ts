import { Command } from "commander";
import { registerListWorkspaces } from "./list.js";
import { registerUseWorkspace } from "./use.js";

export function registerWorkspaces(parent: Command): void {
  const group = new Command("workspaces").description(
    "List workspaces and set the active one",
  );
  registerListWorkspaces(group);
  registerUseWorkspace(group);
  parent.addCommand(group);
}
