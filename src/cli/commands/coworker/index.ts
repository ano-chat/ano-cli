import { Command } from "commander";

import { registerCoworkerWebhookTest } from "./webhook-test.js";
import { registerCoworkerCreate } from "./create.js";

export function registerCoworker(parent: Command): void {
  const group = new Command("coworker").description(
    "Create coworkers (managed or external) and test their webhooks",
  );
  registerCoworkerCreate(group);
  registerCoworkerWebhookTest(group);
  parent.addCommand(group);
}
