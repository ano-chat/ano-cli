import { Command } from "commander";
import { registerAuthLogin } from "./login.js";
import { registerAuthLogout } from "./logout.js";
import { registerAuthStatus } from "./status.js";

export function registerAuth(parent: Command): void {
  const group = new Command("auth").description("Manage authentication");
  registerAuthLogin(group);
  registerAuthLogout(group);
  registerAuthStatus(group);
  parent.addCommand(group);
}
