import { Command } from "commander";
import { registerListDms } from "./list.js";
import { registerReadDm } from "./read.js";
import { registerSendDm } from "./send.js";

export function registerDm(parent: Command): void {
  const group = new Command("dm").description("Manage direct messages");
  registerListDms(group);
  registerReadDm(group);
  registerSendDm(group);
  parent.addCommand(group);
}
