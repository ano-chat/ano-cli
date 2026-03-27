import { createProgram } from "./cli/root.js";
import { registerAllCommands } from "./cli/register.js";
import { handleAgentHelp } from "./cli/middleware/agent-help.js";

// If --agent and --help are both present, handle structured JSON help
// before commander parses (commander exits on --help before we can intercept)
if (process.argv.includes("--agent") && process.argv.includes("--help")) {
  const program = createProgram();
  registerAllCommands(program);
  handleAgentHelp(program);
} else {
  const program = createProgram();
  registerAllCommands(program);
  program.parse();
}
