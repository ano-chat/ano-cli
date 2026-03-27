import { Command } from "commander";
import { registerListUsers } from "./list.js";

export function registerUsers(parent: Command): void {
  const group = new Command("users").description("List workspace members");
  registerListUsers(group);
  parent.addCommand(group);
}
