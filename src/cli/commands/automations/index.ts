import { Command } from "commander";
import { registerAutomationCompile } from "./compile.js";
import { registerAutomationCreate } from "./create.js";
import { registerAutomationList } from "./list.js";
import { registerAutomationRuns } from "./runs.js";
import { registerAutomationPause } from "./pause.js";
import { registerAutomationDelete } from "./delete.js";

export function registerAutomations(parent: Command): void {
  const group = new Command("automation").description(
    "Compile, create, list, and manage scheduled jobs + webhook automations",
  );
  registerAutomationCompile(group);
  registerAutomationCreate(group);
  registerAutomationList(group);
  registerAutomationRuns(group);
  registerAutomationPause(group);
  registerAutomationDelete(group);
  parent.addCommand(group);
}
