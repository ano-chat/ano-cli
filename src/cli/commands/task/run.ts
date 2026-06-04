import { spawn } from "node:child_process";

import type { GlobalOptions } from "../../types.js";
import { resolveAuth } from "../../../core/auth.js";
import { createApiClient } from "../../../core/api-client.js";
import { readTask, writeTask } from "../../../core/task-store.js";

/**
 * Run a local `claude -p "<prompt>"` and resolve with its stdout, or an
 * error string on spawn failure / non-zero exit. Never rejects — the
 * runner records the failure on the task instead of crashing.
 */
function runClaude(
  prompt: string,
): Promise<{ result: string | null; error: string | null }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("claude", ["-p", prompt], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({
        result: null,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      // ENOENT: `claude` not on PATH. Surface a friendly hint.
      const msg =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? "`claude` CLI not found on PATH. Install Claude Code to run background tasks."
          : err.message;
      resolve({ result: null, error: msg });
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ result: stdout.trim(), error: null });
      } else {
        const detail = stderr.trim() || stdout.trim();
        resolve({
          result: null,
          error: `claude -p exited with code ${code}${detail ? `: ${detail}` : ""}`,
        });
      }
    });
  });
}

/**
 * THE RUNNER. Executed detached as `ano task __run <id>`. Reads the
 * queued task, marks it running, invokes `claude -p`, optionally posts
 * the result to the target channel, then records the terminal state.
 *
 * Idempotent and self-healing: a missing or non-queued task is a no-op
 * (guards against a double-spawn racing the same id). Runs under the
 * default profile/auth — fine for v1.
 */
export async function runTask(
  id: string,
  globals: GlobalOptions,
): Promise<void> {
  const task = await readTask(id);
  if (!task || task.status !== "queued") return;

  task.status = "running";
  task.started_at = Date.now();
  await writeTask(task);

  const { result, error } = await runClaude(task.prompt);
  task.result = result;
  task.error = error;

  // Best-effort channel post only on a clean run with a target. A post
  // failure downgrades the task to failed but preserves the result so
  // the shell hook can still relay it.
  if (!error && task.target && result) {
    try {
      const auth = resolveAuth(globals);
      const client = createApiClient(auth);
      await client.sendMessage({
        channel_name: task.target,
        content: result,
      });
    } catch (postErr) {
      task.error = `task ran, but posting to "${task.target}" failed: ${
        postErr instanceof Error ? postErr.message : String(postErr)
      }`;
    }
  }

  task.status = task.error ? "failed" : "done";
  task.completed_at = Date.now();
  await writeTask(task);
}
