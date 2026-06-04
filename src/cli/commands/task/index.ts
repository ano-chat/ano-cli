import { spawn } from "node:child_process";

import { Command } from "commander";

import type { GlobalOptions } from "../../types.js";
import { withErrorHandler } from "../../middleware/error-handler.js";
import { output } from "../../../core/output.js";
import { createTask, listTasks, readTask } from "../../../core/task-store.js";
import { runTask } from "./run.js";

interface TaskDispatchOpts {
  to?: string;
}

/**
 * Spawn the runner DETACHED so the parent `ano task` returns instantly.
 * The child re-invokes this same CLI binary as `task __run <id>`.
 *
 * ANO_NO_DAEMON=1 forces the child onto the direct path — otherwise the
 * daemon shim would dispatch `__run` to a long-lived daemon process,
 * defeating the point of a detached background worker (and the daemon
 * has no stdin to stream `claude -p` from).
 */
function spawnRunner(id: string): void {
  const entry = process.argv[1];
  const child = spawn(process.execPath, [entry, "task", "__run", id], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ANO_NO_DAEMON: "1" },
  });
  child.unref();
}

export function registerTask(parent: Command): void {
  const group = new Command("task").description(
    "Dispatch a fire-and-forget background `claude -p` task; its result is surfaced back in your shell when it finishes",
  );

  // DEFAULT action: `ano task "<prompt>" [--to <channel-name>]`
  group
    .argument("[prompt]", "What the background Claude run should do")
    .option(
      "--to <channel-name>",
      "Post the result to this channel when the task finishes",
    )
    .action(
      withErrorHandler(
        async (prompt: string | undefined, opts: TaskDispatchOpts, cmd) => {
          // No prompt → show help (the subcommands are still reachable).
          if (!prompt || prompt.trim().length === 0) {
            cmd.help();
            return;
          }

          const globals = cmd.optsWithGlobals() as GlobalOptions;
          const target = opts.to ?? null;
          const task = await createTask(prompt, target);
          spawnRunner(task.id);

          const where = target
            ? ` The result will also be posted to ${target}.`
            : "";
          output(globals, {
            data: { id: task.id, status: task.status, target },
            title: `✓ queued — ${task.id}. Keep working; the result will appear in your shell when it's done.${where}`,
            breadcrumbs: [
              {
                action: "task_list",
                cmd: "ano task list",
                description: "List background tasks and their status",
              },
              {
                action: "task_result",
                cmd: `ano task result ${task.id}`,
                description: "Print this task's result once it finishes",
              },
            ],
          });
        },
      ),
    );

  // `ano task list`
  group
    .command("list")
    .description("List background tasks, newest first")
    .action(
      withErrorHandler(async (_opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const tasks = await listTasks();
        const rows = tasks.map((t) => ({
          id: t.id,
          status: t.status,
          target: t.target ?? "—",
          prompt:
            t.prompt.length > 60 ? t.prompt.slice(0, 57) + "..." : t.prompt,
        }));
        output(globals, {
          data: rows,
          columns: ["id", "status", "target", "prompt"],
          title: rows.length ? "Background tasks" : "No background tasks yet",
        });
      }),
    );

  // `ano task result <id>`
  group
    .command("result <id>")
    .description("Print a task's result (or error)")
    .action(
      withErrorHandler(async (id: string, _opts, cmd) => {
        const globals = cmd.optsWithGlobals() as GlobalOptions;
        const task = await readTask(id);
        if (!task) {
          throw new Error(`Task ${id} not found.`);
        }
        output(globals, {
          data: {
            id: task.id,
            status: task.status,
            result: task.result,
            error: task.error,
          },
          title: `${task.id} — ${task.status}`,
        });
      }),
    );

  // Hidden runner: `ano task __run <id>` (spawned detached; not for humans).
  group.command("__run <id>", { hidden: true }).action(
    withErrorHandler(async (id: string, _opts, cmd) => {
      const globals = cmd.optsWithGlobals() as GlobalOptions;
      await runTask(id, globals);
    }),
  );

  parent.addCommand(group);
}
