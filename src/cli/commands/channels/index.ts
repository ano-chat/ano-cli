import { Command } from "commander";
import { registerListChannels } from "./list.js";

export function registerChannels(parent: Command): void {
  const group = new Command("channels").description(
    "List and manage channels",
  );
  registerListChannels(group);
  parent.addCommand(group);
}
