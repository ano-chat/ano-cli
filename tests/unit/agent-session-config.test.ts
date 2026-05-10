/**
 * Tests for the local opt-in flag + per-cwd session_id cache.
 *
 * Uses a temp HOME so reads/writes don't touch the real
 * `~/.config/ano/` dir. Each test gets a fresh dir.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "ano-session-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = tempHome;
  // configDir() is captured at module load time, so reset modules so
  // the next import sees the fresh HOME.
  vi.resetModules();
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(tempHome, { recursive: true, force: true });
});

async function freshImport() {
  return (await import("../../src/core/agent-session-config.js")) as typeof import("../../src/core/agent-session-config.js");
}

describe("getAgentStatusOptIn / setAgentStatusOptIn", () => {
  it("defaults to 'unset' when no settings file exists", async () => {
    const { getAgentStatusOptIn } = await freshImport();
    expect(getAgentStatusOptIn()).toBe("unset");
  });

  it("round-trips 'enabled'", async () => {
    const { getAgentStatusOptIn, setAgentStatusOptIn } = await freshImport();
    setAgentStatusOptIn("enabled");
    expect(getAgentStatusOptIn()).toBe("enabled");
    expect(existsSync(join(tempHome, ".config", "ano", "settings.json"))).toBe(
      true,
    );
  });

  it("round-trips 'disabled'", async () => {
    const { getAgentStatusOptIn, setAgentStatusOptIn } = await freshImport();
    setAgentStatusOptIn("disabled");
    expect(getAgentStatusOptIn()).toBe("disabled");
  });

  it("returns 'unset' when settings.json is malformed JSON", async () => {
    const { getAgentStatusOptIn } = await freshImport();
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(tempHome, ".config", "ano"), { recursive: true });
    writeFileSync(
      join(tempHome, ".config", "ano", "settings.json"),
      "{not valid json",
    );
    expect(getAgentStatusOptIn()).toBe("unset");
  });
});

describe("session cache (writeCachedSession / readCachedSession)", () => {
  it("returns null when no cache exists for this cwd", async () => {
    const { readCachedSession } = await freshImport();
    expect(readCachedSession()).toBeNull();
  });

  it("round-trips a session id keyed by cwd", async () => {
    const { writeCachedSession, readCachedSession } = await freshImport();
    writeCachedSession({
      session_id: "sess-abc",
      workspace_id: "ws-1",
      list_id: "list-1",
      started_at: 1700000000000,
    });
    const cached = readCachedSession();
    expect(cached?.session_id).toBe("sess-abc");
    expect(cached?.workspace_id).toBe("ws-1");
    expect(cached?.list_id).toBe("list-1");
    expect(cached?.started_at).toBe(1700000000000);
    expect(cached?.written_at).toBeDefined();
  });

  it("returns the SAME id for the same cwd across reads", async () => {
    const { writeCachedSession, readCachedSession } = await freshImport();
    writeCachedSession({ session_id: "sess-1" });
    expect(readCachedSession()?.session_id).toBe("sess-1");
    expect(readCachedSession()?.session_id).toBe("sess-1");
  });

  it("isolates by cwd argument", async () => {
    const { writeCachedSession, readCachedSession } = await freshImport();
    writeCachedSession({ session_id: "sess-A" }, "/tmp/worktree-a");
    writeCachedSession({ session_id: "sess-B" }, "/tmp/worktree-b");
    expect(readCachedSession("/tmp/worktree-a")?.session_id).toBe("sess-A");
    expect(readCachedSession("/tmp/worktree-b")?.session_id).toBe("sess-B");
  });

  it("clearCachedSession removes the cache", async () => {
    const { writeCachedSession, readCachedSession, clearCachedSession } =
      await freshImport();
    writeCachedSession({ session_id: "sess-1" });
    expect(readCachedSession()).not.toBeNull();
    clearCachedSession();
    expect(readCachedSession()).toBeNull();
  });
});
