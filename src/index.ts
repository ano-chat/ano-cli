/**
 * `ano` CLI entry point.
 *
 * Two-stage flow to keep warm-daemon calls fast:
 *
 *   1. Daemon shim (synchronous import; tiny — only `node:net` +
 *      protocol types). If a running daemon answers our socket, the
 *      command is dispatched there and we synchronously `process.exit`
 *      with the daemon's reply.
 *
 *   2. Direct fallback (dynamic import; loads the full command tree
 *      lazily). Used when the daemon isn't running, the command opts
 *      out (auth, daemon control, stdin-piped commands), or the daemon
 *      reports an error.
 *
 * The dynamic import is what makes step 1 cheap: tsup `splitting: true`
 * splits the heavy command modules into a separate chunk that only
 * loads on the fallback path. Cold call ≈ today's cost. Warm call ≈
 * just the daemon round trip (~70 ms saved).
 */
import { runWithDaemon, shouldBypass } from "./daemon/client.js";

const argv = process.argv.slice(2);

async function runDirectly(): Promise<void> {
  const { createProgram } = await import("./cli/root.js");
  const { registerAllCommands } = await import("./cli/register.js");
  const { handleAgentHelp } = await import("./cli/middleware/agent-help.js");

  // If --agent and --help are both present, handle structured JSON help
  // before commander parses (commander exits on --help before we can intercept).
  if (argv.includes("--agent") && argv.includes("--help")) {
    const program = createProgram();
    registerAllCommands(program);
    handleAgentHelp(program);
    return;
  }
  const program = createProgram();
  registerAllCommands(program);
  await program.parseAsync(process.argv);
}

if (shouldBypass(argv)) {
  await runDirectly();
} else {
  // runWithDaemon synchronously process.exits on success — if it
  // returns, the daemon path didn't apply.
  const handled = await runWithDaemon(argv);
  if (!handled) await runDirectly();
}
