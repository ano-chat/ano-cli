import { mkdtempSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// task-store derives every path from os.homedir(), so point HOME at a
// throwaway temp dir per test run. ESM module namespaces aren't
// spy-able (vi.spyOn fails on node:os), so we mock the module and feed
// homedir() a mutable holder the tests reassign in beforeEach.
const homeHolder = { value: "" };

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => homeHolder.value };
});

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "ano-task-store-"));
  homeHolder.value = tmpHome;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const { tasksDir, createTask, readTask, writeTask, listTasks } =
  await import("./task-store.js");

describe("tasksDir", () => {
  it("resolves under ~/.cache/ano/tasks", () => {
    expect(tasksDir()).toBe(join(tmpHome, ".cache", "ano", "tasks"));
  });
});

describe("createTask", () => {
  it("creates a queued task with a t_-prefixed id and persists it", async () => {
    const task = await createTask("hello world", "#general");

    expect(task.id).toMatch(/^t_[0-9a-f]{8}$/);
    expect(task.status).toBe("queued");
    expect(task.prompt).toBe("hello world");
    expect(task.target).toBe("#general");
    expect(task.result).toBeNull();
    expect(task.error).toBeNull();
    expect(task.surfaced).toBe(false);
    expect(typeof task.created_at).toBe("number");
    expect(task.started_at).toBeNull();
    expect(task.completed_at).toBeNull();

    // File landed on disk and round-trips.
    const onDisk = await readTask(task.id);
    expect(onDisk).toEqual(task);

    const files = await readdir(tasksDir());
    expect(files).toContain(`${task.id}.json`);
  });

  it("accepts a null target (shell-only)", async () => {
    const task = await createTask("no channel", null);
    expect(task.target).toBeNull();
  });

  it("mints unique ids across calls", async () => {
    const a = await createTask("a", null);
    const b = await createTask("b", null);
    expect(a.id).not.toBe(b.id);
  });
});

describe("readTask", () => {
  it("returns null for a missing task", async () => {
    expect(await readTask("t_deadbeef")).toBeNull();
  });
});

describe("writeTask", () => {
  it("overwrites an existing task in place", async () => {
    const task = await createTask("update me", null);
    task.status = "running";
    task.started_at = 123;
    await writeTask(task);

    const reread = await readTask(task.id);
    expect(reread?.status).toBe("running");
    expect(reread?.started_at).toBe(123);
  });

  it("creates the tasks directory if absent", async () => {
    // Fresh HOME — no tasks dir yet.
    await writeTask({
      id: "t_12345678",
      prompt: "p",
      target: null,
      status: "queued",
      result: null,
      error: null,
      surfaced: false,
      created_at: Date.now(),
      started_at: null,
      completed_at: null,
    });
    expect(await readTask("t_12345678")).not.toBeNull();
  });
});

describe("listTasks", () => {
  it("returns [] when the tasks dir does not exist", async () => {
    expect(await listTasks()).toEqual([]);
  });

  it("returns tasks newest-first by created_at", async () => {
    const older = await createTask("older", null);
    older.created_at = 1000;
    await writeTask(older);

    const newer = await createTask("newer", null);
    newer.created_at = 2000;
    await writeTask(newer);

    const list = await listTasks();
    expect(list.map((t) => t.id)).toEqual([newer.id, older.id]);
  });

  it("ignores non-json files in the tasks dir", async () => {
    const task = await createTask("real", null);
    // Drop a stray file alongside the task json.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(tasksDir(), "notes.txt"), "ignore me", "utf-8");

    const list = await listTasks();
    expect(list.map((t) => t.id)).toEqual([task.id]);
  });
});
