import { Command } from "commander";
import { withErrorHandler } from "../../middleware/error-handler.js";
import {
  loadGlobalCredentials,
  saveGlobalCredentials,
} from "../../../core/config.js";

export function registerAuthLogout(parent: Command): void {
  parent
    .command("logout")
    .description("Remove saved credentials")
    .option("-p, --profile <name>", "Profile to remove", "default")
    .action(
      withErrorHandler(async (opts, _cmd) => {
        const creds = loadGlobalCredentials();
        if (!creds || !creds.profiles[opts.profile]) {
          console.log(`No profile "${opts.profile}" found.`);
          return;
        }

        delete creds.profiles[opts.profile];
        saveGlobalCredentials(creds);
        console.log(`Profile "${opts.profile}" removed.`);
      }),
    );
}
