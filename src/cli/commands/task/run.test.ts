import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AsyncTask } from "../../../core/task-store.js";
import type { GlobalOptions } from "../../types.js";

// --- mocks -----------------------------------------------------------

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

const sendMessageMock = vi.fn();
vi.mock("../../../core/api-client.js", () => ({
  createApiClient: () => ({ sendMessage: sendMessageMock }),
}));
vi.mock("../../../core/auth.js", () => ({
  resolveAuth: () => ({ key: "k", endpoint: "http://x", source: "global" }),
}));

// In-memory task store keyed by id.
const store = new Map<string, AsyncTask>();
vi.mock("../../../core/task-store.js", () => ({
  readTask: vi.fn(async (id: string) => store.get(id) ?? null),
  writeTask: vi.fn(async (task: AsyncTask) => {
    store.set(task.id, { ...task });
  }),
}));

const { runTask } = await import("./run.js");

const globals = { endpoint: "http://x" } as GlobalOptions;

/** Build a fake child process whose close/error we drive from the test. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

/** Resolve once spawn() has been invoked and listeners are attached. */
async function waitForSpawn(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (spawnMock.mock.calls.length > 0) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error("spawn was never called");
}

function seed(overrides: Partial<AsyncTask> = {}): AsyncTask {
  const task: AsyncTask = {
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
  store.set(task.id, task);
  return task;
}

beforeEach(() => {
  store.clear();
  spawnMock.mockReset();
  sendMessageMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runTask", () => {
  it("no-ops when the task is missing", async () => {
    await runTask("t_missing00", globals);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("no-ops when the task is not queued (double-spawn guard)", async () => {
    seed({ status: "running" });
    await runTask("t_abc12345", globals);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("captures claude stdout and marks the task done", async () => {
    seed();
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const p = runTask("t_abc12345", globals);
    await waitForSpawn();
    child.stdout.emit("data", Buffer.from("the answer\n"));
    child.emit("close", 0);
    await p;

    expect(spawnMock).toHaveBeenCalledWith("claude", ["-p", "do a thing"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const task = store.get("t_abc12345")!;
    expect(task.status).toBe("done");
    expect(task.result).toBe("the answer");
    expect(task.error).toBeNull();
    expect(task.completed_at).toBeGreaterThan(0);
  });

  it("records a friendly error when claude is not on PATH", async () => {
    seed();
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const p = runTask("t_abc12345", globals);
    await waitForSpawn();
    const enoent = Object.assign(new Error("spawn claude ENOENT"), {
      code: "ENOENT",
    });
    child.emit("error", enoent);
    await p;

    const task = store.get("t_abc12345")!;
    expect(task.status).toBe("failed");
    expect(task.error).toMatch(/claude.*not found on PATH/i);
  });

  it("marks failed on a non-zero exit and includes stderr", async () => {
    seed();
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const p = runTask("t_abc12345", globals);
    await waitForSpawn();
    child.stderr.emit("data", Buffer.from("boom"));
    child.emit("close", 2);
    await p;

    const task = store.get("t_abc12345")!;
    expect(task.status).toBe("failed");
    expect(task.error).toContain("exited with code 2");
    expect(task.error).toContain("boom");
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("posts the result to the target channel on success", async () => {
    seed({ target: "#general" });
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    sendMessageMock.mockResolvedValue({ ok: true });

    const p = runTask("t_abc12345", globals);
    await waitForSpawn();
    child.stdout.emit("data", Buffer.from("posted result"));
    child.emit("close", 0);
    await p;

    expect(sendMessageMock).toHaveBeenCalledWith({
      channel_name: "#general",
      content: "posted result",
    });
    expect(store.get("t_abc12345")!.status).toBe("done");
  });

  it("downgrades to failed but keeps the result when posting fails", async () => {
    seed({ target: "#general" });
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    sendMessageMock.mockRejectedValue(new Error("403 forbidden"));

    const p = runTask("t_abc12345", globals);
    await waitForSpawn();
    child.stdout.emit("data", Buffer.from("kept result"));
    child.emit("close", 0);
    await p;

    const task = store.get("t_abc12345")!;
    expect(task.status).toBe("failed");
    expect(task.result).toBe("kept result");
    expect(task.error).toMatch(/posting to "#general" failed.*403 forbidden/);
  });
});
