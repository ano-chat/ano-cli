import { Command } from "commander";

import { registerDndSet } from "./set.js";

export function registerDnd(parent: Command): void {
  const group = new Command("dnd").description(
    "Manage Do Not Disturb settings",
  );
  registerDndSet(group);
  parent.addCommand(group);
}
