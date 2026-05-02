import type { Command } from "commander";
import { registerAuth } from "./commands/auth/index.js";
import { registerChannels } from "./commands/channels/index.js";
import { registerMessages } from "./commands/messages/index.js";
import { registerDm } from "./commands/dm/index.js";
import { registerUsers } from "./commands/users/index.js";
import { registerWorkspaces } from "./commands/workspaces/index.js";
import { registerConnect } from "./commands/connect/index.js";
import { registerSetup } from "./commands/setup/index.js";
import { registerDoctor } from "./commands/doctor.js";
import { registerShow } from "./commands/show.js";
import { registerCommands } from "./commands/commands.js";
import { registerTables } from "./commands/tables/index.js";
import { registerAutomations } from "./commands/automations/index.js";
import { registerNew } from "./commands/new/index.js";

export function registerAllCommands(program: Command): void {
  registerAuth(program);
  registerChannels(program);
  registerMessages(program);
  registerDm(program);
  registerUsers(program);
  registerWorkspaces(program);
  registerTables(program);
  registerAutomations(program);
  registerNew(program);
  registerConnect(program);
  registerSetup(program);
  registerDoctor(program);
  registerShow(program);
  registerCommands(program);
}
