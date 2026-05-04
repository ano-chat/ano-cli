import { Command } from "commander";

import { registerCoworkerWebhookTest } from "./webhook-test.js";

export function registerCoworker(parent: Command): void {
  const group = new Command("coworker").description(
    "Manage external coworker integrations (webhook tests etc.)",
  );
  registerCoworkerWebhookTest(group);
  parent.addCommand(group);
}
