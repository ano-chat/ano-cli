import { Command } from "commander";
import { registerListWorkspaces } from "./list.js";

export function registerWorkspaces(parent: Command): void {
  const group = new Command("workspaces").description("List workspaces");
  registerListWorkspaces(group);
  parent.addCommand(group);
}
