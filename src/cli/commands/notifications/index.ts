import { Command } from "commander";

import { registerNotificationsPrefsSet } from "./prefs-set.js";

export function registerNotifications(parent: Command): void {
  const group = new Command("notifications").description(
    "Manage notification preferences",
  );
  registerNotificationsPrefsSet(group);
  parent.addCommand(group);
}
