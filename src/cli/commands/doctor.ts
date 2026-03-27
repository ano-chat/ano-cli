import { Command } from "commander";
import type { GlobalOptions } from "../types.js";
import { withErrorHandler } from "../middleware/error-handler.js";
import { resolveAuth } from "../../core/auth.js";
import { createApiClient } from "../../core/api-client.js";
import { output } from "../../core/output.js";
import { green, red, yellow, dim } from "../../util/colors.js";

interface CheckResult {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
}

export function registerDoctor(parent: Command): void {
  parent
    .command("doctor")
    .description("Diagnose auth, connectivity, and API health")
    .action(
      withErrorHandler(async (_opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const checks: CheckResult[] = [];

        // 1. Auth check
        let auth;
        try {
          auth = resolveAuth(globals);
          checks.push({
            name: "Auth",
            status: "pass",
            message: `Key found (source: ${auth.source}, prefix: ${auth.key.slice(0, 12)}...)`,
          });
        } catch (err) {
          checks.push({
            name: "Auth",
            status: "fail",
            message: (err as Error).message,
          });
          printChecks(globals, checks);
          return;
        }

        // 2. API connectivity
        try {
          const client = createApiClient(auth);
          const ctx = await client.context();
          checks.push({
            name: "API",
            status: "pass",
            message: `Connected to ${auth.endpoint}`,
          });
          checks.push({
            name: "Workspace",
            status: "pass",
            message: `${ctx.workspace.name} (${ctx.workspace.member_count} members)`,
          });
          checks.push({
            name: "Identity",
            status: "pass",
            message: `${ctx.user.name} (${ctx.user.role})`,
          });
          checks.push({
            name: "Channels",
            status: ctx.channels.length > 0 ? "pass" : "warn",
            message: `${ctx.channels.length} channels accessible`,
          });
        } catch (err) {
          checks.push({
            name: "API",
            status: "fail",
            message: (err as Error).message,
          });
        }

        printChecks(globals, checks);
      }),
    );
}

function printChecks(globals: GlobalOptions, checks: CheckResult[]) {
  const failed = checks.some((c) => c.status === "fail");

  if (globals.json || globals.agent || globals.quiet) {
    output(globals, {
      data: checks,
      breadcrumbs: [
        {
          action: "auth_login",
          cmd: "ano auth login --key <key>",
          description: "Re-authenticate",
        },
        {
          action: "connect",
          cmd: "ano connect",
          description: "Start real-time bridge",
        },
      ],
    });
  } else {
    const icons = { pass: green("✓"), fail: red("✗"), warn: yellow("!") };
    for (const c of checks) {
      console.log(`  ${icons[c.status]} ${c.name}: ${dim(c.message)}`);
    }
    console.log(
      failed
        ? `\n${red("Issues found.")}`
        : `\n${green("All checks passed.")}`,
    );
  }

  if (failed) process.exit(1);
}
