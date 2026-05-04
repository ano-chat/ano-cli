import { Command } from "commander";
import { registerListChannels } from "./list.js";
import { registerChannelCreate } from "./create.js";
import { registerChannelArchive } from "./archive.js";
import { registerChannelMemberAdd } from "./member-add.js";
import { registerChannelMemberRemove } from "./member-remove.js";

export function registerChannels(parent: Command): void {
  const group = new Command("channels").description("List and manage channels");
  registerListChannels(group);
  registerChannelCreate(group);
  registerChannelArchive(group);
  registerChannelMemberAdd(group);
  registerChannelMemberRemove(group);
  parent.addCommand(group);
}
