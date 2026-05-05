import { Command } from "commander";
import { registerIntegrationsConnect } from "./connect.js";

export function registerIntegrations(parent: Command): void {
  const group = new Command("integrations").description(
    "Manage third-party service connections (OAuth via Pipedream Connect)",
  );
  registerIntegrationsConnect(group);
  parent.addCommand(group);
}
