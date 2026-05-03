import { Command } from "commander";
import { registerAutomationCompile } from "./compile.js";
import { registerAutomationCreate } from "./create.js";
import { registerAutomationCreateCompiled } from "./create-compiled.js";
import { registerAutomationList } from "./list.js";
import { registerAutomationRuns } from "./runs.js";
import { registerAutomationRun } from "./run.js";
import { registerAutomationPause } from "./pause.js";
import { registerAutomationDelete } from "./delete.js";
import { registerAutomationUpdate } from "./update.js";
import { registerAutomationWebhookSetup } from "./webhook-setup.js";
import { registerAutomationValidate } from "./validate.js";
import { registerAutomationWebhookTest } from "./webhook-test.js";

export function registerAutomations(parent: Command): void {
  const group = new Command("automation").description(
    "Compile, create, list, and manage scheduled jobs + webhook automations",
  );
  registerAutomationCompile(group);
  registerAutomationCreate(group);
  registerAutomationCreateCompiled(group);
  registerAutomationValidate(group);
  registerAutomationUpdate(group);
  registerAutomationList(group);
  registerAutomationRuns(group);
  registerAutomationRun(group);
  registerAutomationPause(group);
  registerAutomationDelete(group);
  registerAutomationWebhookSetup(group);
  registerAutomationWebhookTest(group);
  parent.addCommand(group);
}
