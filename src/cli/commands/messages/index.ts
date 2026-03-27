import { Command } from "commander";
import { registerReadMessages } from "./read.js";
import { registerSendMessage } from "./send.js";
import { registerSearchMessages } from "./search.js";

export function registerMessages(parent: Command): void {
  const group = new Command("messages").description(
    "Read, send, and search messages",
  );
  registerReadMessages(group);
  registerSendMessage(group);
  registerSearchMessages(group);
  parent.addCommand(group);
}
