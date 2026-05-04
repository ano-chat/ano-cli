import { Command } from "commander";
import { registerListWorkspaces } from "./list.js";
import { registerUseWorkspace } from "./use.js";
import { registerWorkspaceMemberAdd } from "./member-add.js";
import { registerWorkspaceMemberRemove } from "./member-remove.js";

export function registerWorkspaces(parent: Command): void {
  const group = new Command("workspaces").description(
    "List workspaces, set the active one, and manage members",
  );
  registerListWorkspaces(group);
  registerUseWorkspace(group);
  registerWorkspaceMemberAdd(group);
  registerWorkspaceMemberRemove(group);
  parent.addCommand(group);
}
