import { Command } from "commander";

import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import {
  clearCachedSession,
  detectGitBranch,
  detectWorktreeLabel,
  getAgentStatusOptIn,
  readCachedSession,
  setAgentStatusOptIn,
  writeCachedSession,
} from "../../../core/agent-session-config.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import type { GlobalOptions } from "../../types.js";

/**
 * `ano session …` — record agent sessions in the workspace's Agent
 * Status list (a Lists template, see ano repo migration 143).
 *
 * The CLI is the bridge between Claude Code's skill (which knows when
 * a session starts / has milestones / ends) and the Ano server. The
 * design is documented in plan `wanna-explore-and-idea-elegant-muffin`.
 *
 * Three opt-in states (see agent-session-config.ts):
 *
 *   • unset (default) — `ano session start` prints a one-line
 *     discovery message to STDERR. STDOUT stays empty so the skill
 *     sees no session_id and stops trying for the rest of the Claude
 *     Code session.
 *   • enabled — CLI calls the MCP op and prints `session_id=<uuid>`
 *     to STDOUT (nothing else on stdout). The skill greps for this
 *     line and proceeds to milestone + end calls.
 *   • disabled — CLI exits 0 silently. No output, no posts.
 *
 * Stdout/stderr discipline is load-bearing: the skill parses stdout
 * for `^session_id=`. If we ever printed a discovery line on stdout
 * we'd false-positive into infinite milestone calls.
 */
export function registerSession(parent: Command): void {
  const group = new Command("session").description(
    "Record agent sessions in the workspace's Agent Status list",
  );
  registerStart(group);
  registerUpdate(group);
  registerEnd(group);
  registerEnable(group);
  registerDisable(group);
  registerStatus(group);
  parent.addCommand(group);
}

const DISCOVERY_LINE =
  "ano session: tracking available — run `ano session enable` to opt this machine in, or `ano session disable` to silence this.";

function registerStart(parent: Command): void {
  parent
    .command("start")
    .description(
      "Start an agent session. No-op if not opted in (see `ano session enable`).",
    )
    .requiredOption("--title <text>", "One-line description of the workstream")
    .option("--branch <name>", "Git branch (auto-detected if omitted)")
    .option("--worktree <path>", "Worktree label (auto-detected if omitted)")
    .option(
      "--kind <agent>",
      "Agent kind: claude_code | codex | other",
      "claude_code",
    )
    .action(
      withErrorHandler(async (opts, cmd) => {
        const optIn = getAgentStatusOptIn();
        if (optIn === "disabled") return; // pure silence
        if (optIn === "unset") {
          process.stderr.write(`${DISCOVERY_LINE}\n`);
          return; // no session_id on stdout — skill abandons further calls
        }

        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        const branch = opts.branch ?? detectGitBranch();
        const worktree = opts.worktree ?? detectWorktreeLabel();
        const kind =
          (opts.kind as "claude_code" | "codex" | "other" | undefined) ??
          "claude_code";

        const result = await client.agentSessionStart({
          workspace_id: globals.workspace,
          title: opts.title,
          branch,
          worktree,
          agent_kind: kind,
        });

        writeCachedSession({
          session_id: result.session_id,
          workspace_id: result.workspace_id,
          list_id: result.list_id,
          started_at: result.started_at,
        });

        // Stdout: ONLY the session_id line. Skill greps for ^session_id=.
        process.stdout.write(`session_id=${result.session_id}\n`);
        // Human-readable status to stderr so it doesn't pollute parsers.
        process.stderr.write(
          `Posted to workspace ${result.workspace_id} (list ${result.list_id}).\n`,
        );
      }),
    );
}

function registerUpdate(parent: Command): void {
  parent
    .command("update")
    .description(
      "Patch progress on an in-flight session. Uses cached session_id from the current cwd unless --session-id is passed.",
    )
    .option(
      "--session-id <uuid>",
      "Session id (defaults to the cached id for this cwd)",
    )
    .option(
      "--status <state>",
      "active | paused (use `session end` for terminal states)",
    )
    .option("--summary <text>", "What's been done since the last update")
    .action(
      withErrorHandler(async (opts, cmd) => {
        const optIn = getAgentStatusOptIn();
        if (optIn !== "enabled") return; // no discovery line on update — start already showed it

        const sessionId = opts.sessionId ?? readCachedSession()?.session_id;
        if (!sessionId) return; // no session to update — silently skip

        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        const status = opts.status as
          | "active"
          | "paused"
          | "done"
          | "failed"
          | undefined;
        await client.agentSessionUpdate({
          session_id: sessionId,
          status,
          summary: opts.summary,
        });
      }),
    );
}

function registerEnd(parent: Command): void {
  parent
    .command("end")
    .description("Mark a session as terminal (done | failed | paused).")
    .option(
      "--session-id <uuid>",
      "Session id (defaults to the cached id for this cwd)",
    )
    .option(
      "--status <state>",
      "Terminal status: done | failed | paused",
      "done",
    )
    .option("--summary <text>", "Final progress note")
    .action(
      withErrorHandler(async (opts, cmd) => {
        const optIn = getAgentStatusOptIn();
        if (optIn !== "enabled") return;

        const sessionId = opts.sessionId ?? readCachedSession()?.session_id;
        if (!sessionId) return;

        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const auth = resolveAuth(globals);
        const client = createApiClient(auth);

        const status = (opts.status as "done" | "failed" | "paused") ?? "done";
        if (!["done", "failed", "paused"].includes(status)) {
          process.stderr.write(
            `Invalid --status: ${status}. Must be done | failed | paused.\n`,
          );
          process.exitCode = 1;
          return;
        }
        await client.agentSessionEnd({
          session_id: sessionId,
          status,
          summary: opts.summary,
        });
        clearCachedSession();
      }),
    );
}

function registerEnable(parent: Command): void {
  parent
    .command("enable")
    .description("Opt this machine in to agent session tracking")
    .action(() => {
      setAgentStatusOptIn("enabled");
      process.stderr.write(
        "Agent session tracking enabled for this machine.\n",
      );
    });
}

function registerDisable(parent: Command): void {
  parent
    .command("disable")
    .description(
      "Opt this machine OUT — `ano session …` will exit silently from now on",
    )
    .action(() => {
      setAgentStatusOptIn("disabled");
      process.stderr.write(
        "Agent session tracking disabled for this machine. Run `ano session enable` to re-enable.\n",
      );
    });
}

function registerStatus(parent: Command): void {
  parent
    .command("status")
    .description(
      "Print the local opt-in state and the cached session for this cwd",
    )
    .action(() => {
      const optIn = getAgentStatusOptIn();
      const cached = readCachedSession();
      process.stderr.write(`opt_in=${optIn}\n`);
      if (cached) {
        process.stderr.write(`cached_session_id=${cached.session_id}\n`);
        if (cached.workspace_id) {
          process.stderr.write(`workspace_id=${cached.workspace_id}\n`);
        }
        if (cached.started_at) {
          process.stderr.write(
            `started_at=${new Date(cached.started_at).toISOString()}\n`,
          );
        }
      } else {
        process.stderr.write(`cached_session_id=(none)\n`);
      }
    });
}
