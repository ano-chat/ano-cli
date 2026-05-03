import { Command } from "commander";
import { registerAutomationCompile } from "./compile.js";
import { registerAutomationCreate } from "./create.js";
import { registerAutomationCreateCompiled } from "./create-compiled.js";
import { registerAutomationList } from "./list.js";
import { registerAutomationRuns } from "./runs.js";
import { registerAutomationPause } from "./pause.js";
import { registerAutomationDelete } from "./delete.js";
import { registerAutomationUpdate } from "./update.js";
import { registerAutomationWebhookSetup } from "./webhook-setup.js";

export function registerAutomations(parent: Command): void {
  const group = new Command("automation").description(
    "Compile, create, list, and manage scheduled jobs + webhook automations",
  );
  registerAutomationCompile(group);
  registerAutomationCreate(group);
  registerAutomationCreateCompiled(group);
  registerAutomationUpdate(group);
  registerAutomationList(group);
  registerAutomationRuns(group);
  registerAutomationPause(group);
  registerAutomationDelete(group);
  registerAutomationWebhookSetup(group);
  parent.addCommand(group);
}
