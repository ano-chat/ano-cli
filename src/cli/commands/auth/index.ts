import { Command } from "commander";
import { registerAuthLogin } from "./login.js";
import { registerAuthLogout } from "./logout.js";
import { registerAuthStatus } from "./status.js";
import { registerAuthComplete } from "./complete.js";
import { registerAuthRefreshRegion } from "./refresh-region.js";

export function registerAuth(parent: Command): void {
  const group = new Command("auth").description("Manage authentication");
  registerAuthLogin(group);
  registerAuthLogout(group);
  registerAuthStatus(group);
  registerAuthComplete(group);
  registerAuthRefreshRegion(group);
  parent.addCommand(group);
}
