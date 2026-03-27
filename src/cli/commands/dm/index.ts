import { Command } from "commander";
import { registerSendDm } from "./send.js";

export function registerDm(parent: Command): void {
  const group = new Command("dm").description("Send direct messages");
  registerSendDm(group);
  parent.addCommand(group);
}
