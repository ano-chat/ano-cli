import { Command } from "commander";

import { registerCoworkerWebhookTest } from "./webhook-test.js";
import { registerCoworkerCreate } from "./create.js";
import { registerCoworkerUpdate } from "./update.js";

export function registerCoworker(parent: Command): void {
  const group = new Command("coworker").description(
    "Create, update, and test coworkers (managed or external)",
  );
  registerCoworkerCreate(group);
  registerCoworkerUpdate(group);
  registerCoworkerWebhookTest(group);
  parent.addCommand(group);
}
