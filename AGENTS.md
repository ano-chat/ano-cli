# AGENTS.md — Engineering Guardrails for AI Agents

## Architecture

- **Commander-based CLI** with Cobra-like command tree
- Commands in `src/cli/commands/<group>/<action>.ts`
- Bridge code in `src/bridge/` (extracted from monorepo `apps/connect/`)
- Core utilities in `src/core/` (api-client, config, output, auth, errors)
- Skill file at `skills/ano/SKILL.md`

## Non-Negotiable Rules

1. Every command **MUST** declare `breadcrumbs` in its output call
2. Every command **MUST** work with `--json`, `--md`, `--quiet`, `--agent` flags via the `output()` function
3. All errors **MUST** use typed `ExitCode` — never raw `process.exit` with arbitrary numbers
4. All errors **MUST** use the `AnoCliError` hierarchy from `src/core/errors.ts`
5. New commands **MUST** be registered in `src/cli/register.ts`
6. `snapshots/surface.json` **MUST** be updated when commands change (`npm run surface:update`)
7. `skills/ano/SKILL.md` command references **MUST** match actual commands (`npm run skill:check`)
8. Bridge code changes **MUST** maintain backward compat with `ano-connect` binary
9. Use `withErrorHandler()` wrapper for all command actions
10. Never log to stdout in commands — use `output()` for data, `process.stderr` for diagnostics

## Adding a New Command

1. Create `src/cli/commands/<group>/<action>.ts`
2. Export a `register<Name>(parent: Command)` function
3. Register it in the group's `index.ts`
4. Register the group in `src/cli/register.ts` (if new group)
5. Include breadcrumbs suggesting logical next steps
6. Run `npm run surface:update`
7. Update `skills/ano/SKILL.md` with the new command
8. Run `npm run skill:check`

## Command Pattern

```typescript
import { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { output } from "../../../core/output.js";

export function registerMyCommand(parent: Command): void {
  parent
    .command("my-command")
    .description("What it does")
    .action(
      withErrorHandler(async (_opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);
        const result = await client.someMethod();

        output(globals, {
          data: result,
          columns: ["col1", "col2"],
          title: "Title",
          breadcrumbs: [
            { action: "next", cmd: "ano next-cmd", description: "What to do next" },
          ],
        });
      }),
    );
}
```

## Testing

- Unit tests: `tests/unit/` — test core modules
- Run: `npm test`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Full CI: `npm run ci`

## File Structure

```
src/
├── index.ts                 # "ano" entry point
├── connect-entry.ts         # "ano-connect" backward-compat entry
├── cli/
│   ├── root.ts              # createProgram() with global options
│   ├── types.ts             # GlobalOptions, ExitCode, etc.
│   ├── register.ts          # registerAllCommands()
│   ├── middleware/           # agent-help, error-handler
│   └── commands/             # Command groups
├── core/                    # api-client, auth, config, output, errors
├── bridge/                  # SSE bridge (extracted from monorepo)
└── util/                    # table renderer, colors
```
