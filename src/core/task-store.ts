import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * "Light" async-task model. A task is a fire-and-forget background
 * `claude -p` run dispatched by `ano task "<prompt>"`. The runner
 * executes the prompt under the user's local Claude subscription and
 * (optionally) posts the result to a channel. A Claude Code Stop hook
 * (shipped by @ano-chat/skills) surfaces the finished result back in
 * the shell.
 *
 * State lives entirely on disk as one JSON file per task under
 * `$HOME/.cache/ano/tasks/<id>.json`. This is the SHARED CONTRACT with
 * the ano-skills Stop hook — keep this shape in lockstep with
 * `hooks/ano-task-stop.sh`. All timestamps are epoch milliseconds.
 */
export type TaskStatus = "queued" | "running" | "done" | "failed";

export interface AsyncTask {
  id: string;
  prompt: string;
  /** Channel name to post the result to, or null for shell-only. */
  target: string | null;
  status: TaskStatus;
  /** Captured stdout of the `claude -p` run once done. */
  result: string | null;
  /** Error message if the run (or post) failed. */
  error: string | null;
  /** Set true once the Stop hook has relayed it to the user. */
  surfaced: boolean;
  /** Epoch ms. */
  created_at: number;
  /** Epoch ms; set when the runner picks it up. */
  started_at: number | null;
  /** Epoch ms; set when status becomes done/failed. */
  completed_at: number | null;
}

/** Absolute path to the tasks directory. */
export function tasksDir(): string {
  return join(homedir(), ".cache", "ano", "tasks");
}

function taskPath(id: string): string {
  return join(tasksDir(), `${id}.json`);
}

/** Short, collision-resistant task id (`t_` + 8 hex chars). */
function newTaskId(): string {
  return "t_" + randomUUID().slice(0, 8);
}

/**
 * Create a queued task and persist it. Returns the freshly written
 * task so the caller can spawn the runner with its id.
 */
export async function createTask(
  prompt: string,
  target: string | null,
): Promise<AsyncTask> {
  const now = Date.now();
  const task: AsyncTask = {
    id: newTaskId(),
    prompt,
    target,
    status: "queued",
    result: null,
    error: null,
    surfaced: false,
    created_at: now,
    started_at: null,
    completed_at: null,
  };
  await writeTask(task);
  return task;
}

/** Read one task by id, or null if it doesn't exist / is unreadable. */
export async function readTask(id: string): Promise<AsyncTask | null> {
  try {
    const raw = await readFile(taskPath(id), "utf-8");
    return JSON.parse(raw) as AsyncTask;
  } catch {
    return null;
  }
}

/** Persist a task (atomic enough for a single local writer per id). */
export async function writeTask(task: AsyncTask): Promise<void> {
  await mkdir(tasksDir(), { recursive: true });
  await writeFile(taskPath(task.id), JSON.stringify(task, null, 2), "utf-8");
}

/** All tasks, newest-first by `created_at`. Skips unparseable files. */
export async function listTasks(): Promise<AsyncTask[]> {
  let names: string[];
  try {
    names = await readdir(tasksDir());
  } catch {
    return [];
  }
  const tasks: AsyncTask[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    const task = await readTask(id);
    if (task) tasks.push(task);
  }
  tasks.sort((a, b) => b.created_at - a.created_at);
  return tasks;
}
