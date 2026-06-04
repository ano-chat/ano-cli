import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

import type { AsyncTask } from "../../../core/task-store.js";

// --- mocks -----------------------------------------------------------

const createTaskMock = vi.fn();
const listTasksMock = vi.fn();
const readTaskMock = vi.fn();
vi.mock("../../../core/task-store.js", () => ({
  createTask: (...a: unknown[]) => createTaskMock(...a),
  listTasks: (...a: unknown[]) => listTasksMock(...a),
  readTask: (...a: unknown[]) => readTaskMock(...a),
}));

const outputMock = vi.fn();
const outputErrorMock = vi.fn();
vi.mock("../../../core/output.js", () => ({
  output: outputMock,
  outputError: outputErrorMock,
}));

// The detached runner spawn — assert we fire it, never actually spawn.
const spawnMock = vi.fn(() => ({ unref: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

// runTask is exercised in run.test.ts; stub it here.
vi.mock("./run.js", () => ({ runTask: vi.fn() }));

const { registerTask } = await import("./index.js");

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerTask(program);
  return program;
}

function task(overrides: Partial<AsyncTask> = {}): AsyncTask {
  return {
    id: "t_abc12345",
    prompt: "do a thing",
    target: null,
    status: "queued",
    result: null,
    error: null,
    surfaced: false,
    created_at: 1,
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  createTaskMock.mockReset();
  listTasksMock.mockReset();
  readTaskMock.mockReset();
  outputMock.mockReset();
  outputErrorMock.mockReset();
  spawnMock.mockClear();
  vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("__test_exit__");
  });
});

describe("ano task <prompt>", () => {
  it("creates a task, spawns the detached runner, and acks instantly", async () => {
    createTaskMock.mockResolvedValue(task());

    await buildProgram().parseAsync(["task", "summarize the repo"], {
      from: "user",
    });

    expect(createTaskMock).toHaveBeenCalledWith("summarize the repo", null);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    // Runner re-invokes this binary as `task __run <id>` with the daemon off.
    const [, args, opts] = spawnMock.mock.calls[0] as unknown as [
      string,
      string[],
      { detached: boolean; env: Record<string, string> },
    ];
    expect(args.slice(-3)).toEqual(["task", "__run", "t_abc12345"]);
    expect(opts.detached).toBe(true);
    expect(opts.env.ANO_NO_DAEMON).toBe("1");
    expect(outputMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: expect.stringContaining("queued — t_abc12345"),
      }),
    );
  });

  it("passes --to through as the target", async () => {
    createTaskMock.mockResolvedValue(task({ target: "#general" }));

    await buildProgram().parseAsync(
      ["task", "post a summary", "--to", "#general"],
      { from: "user" },
    );

    expect(createTaskMock).toHaveBeenCalledWith("post a summary", "#general");
  });
});

describe("ano task list", () => {
  it("renders tasks with a truncated prompt column", async () => {
    listTasksMock.mockResolvedValue([
      task({ id: "t_1", status: "done", prompt: "x".repeat(80) }),
    ]);

    await buildProgram().parseAsync(["task", "list"], { from: "user" });

    expect(outputMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: [
          expect.objectContaining({
            id: "t_1",
            status: "done",
            prompt: "x".repeat(57) + "...",
          }),
        ],
        columns: ["id", "status", "target", "prompt"],
      }),
    );
  });
});

describe("ano task result <id>", () => {
  it("prints the result for a known task", async () => {
    readTaskMock.mockResolvedValue(
      task({ status: "done", result: "the answer" }),
    );

    await buildProgram().parseAsync(["task", "result", "t_abc12345"], {
      from: "user",
    });

    expect(readTaskMock).toHaveBeenCalledWith("t_abc12345");
    expect(outputMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({ result: "the answer" }),
      }),
    );
  });

  it("errors on an unknown task id", async () => {
    readTaskMock.mockResolvedValue(null);

    await expect(
      buildProgram().parseAsync(["task", "result", "t_nope0000"], {
        from: "user",
      }),
    ).rejects.toThrow("__test_exit__");
    const call = outputErrorMock.mock.calls[0] as unknown[];
    expect(call[1]).toBe("Task t_nope0000 not found.");
  });
});
