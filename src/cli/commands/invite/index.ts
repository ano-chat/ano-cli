import { Command } from "commander";

import { registerInviteCreate } from "./create.js";

export function registerInvite(parent: Command): void {
  const group = new Command("invite").description(
    "Create workspace invites (email is the caller's responsibility — we return the URL)",
  );
  registerInviteCreate(group);
  parent.addCommand(group);
}
