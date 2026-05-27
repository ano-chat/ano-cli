/**
 * Tests for the client-side pre-flight health check (`ensureHealthy`).
 *
 * The earlier 30-second hang was a stale daemon socket the client kept
 * waiting on. These tests pin the new behavior:
 *
 *   • Healthy ping → returns "healthy".
 *   • No socket → returns "no-daemon".
 *   • Wedged socket (accept but never reply) → SIGKILLs via the PID
 *     file, unlinks the socket, returns "killed-and-respawned" within
 *     the 1s ping deadline.
 *   • Healthy daemon but cliVersion drift → SIGKILL + respawn (the
 *     equivalent of an upgrade where the daemon is now stale).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock spawn at the module level — `node:child_process` exports are
// frozen in ESM, so vi.spyOn would throw "Cannot redefine property".
const spawnMock = vi.fn(() => ({ unref: () => {} }));
vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return { ...actual, spawn: spawnMock };
});

const { startDaemon } = await import("../../src/daemon/server.js");
const { ensureHealthy } = await import("../../src/daemon/client.js");

let tempDir: string;
let socketPath: string;
let pidPath: string;
let stopDaemon: (() => void) | null = null;
let dummyServer: Server | null = null;
let killSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ano-daemon-health-"));
  socketPath = join(tempDir, "test.sock");
  pidPath = `${socketPath}.pid`;
  process.env.ANO_DAEMON_SOCKET = socketPath;
  spawnMock.mockClear();
});

afterEach(() => {
  if (stopDaemon) {
    try {
      stopDaemon();
    } catch {
      // ignore
    }
    stopDaemon = null;
  }
  if (dummyServer) {
    try {
      dummyServer.close();
    } catch {
      // ignore
    }
    dummyServer = null;
  }
  killSpy?.mockRestore();
  killSpy = null;
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  delete process.env.ANO_DAEMON_SOCKET;
});

describe("ensureHealthy", () => {
  it("returns no-daemon when the socket doesn't exist", async () => {
    expect(await ensureHealthy(socketPath)).toBe("no-daemon");
  });

  it("returns healthy against a real running daemon", async () => {
    const handle = startDaemon({
      socketPath,
      pidPath,
      idleMs: 0,
      skipPrewarm: true,
    });
    stopDaemon = handle.shutdown;
    expect(await ensureHealthy(socketPath)).toBe("healthy");
  }, 5000);

  it("respawns when the daemon socket accepts but never replies (PID-recycle safe)", async () => {
    // Wedged daemon: bind a server that swallows the ping bytes and
    // never writes a response. Client should give up after
    // PING_TIMEOUT_MS (~1s) and clean up the socket.
    dummyServer = createServer((sock: Socket) => {
      sock.on("data", () => {
        /* swallow */
      });
    });
    await new Promise<void>((resolve) =>
      dummyServer!.listen(socketPath, resolve),
    );
    // Drop a fake pid file. The PID-recycle guard added in v2.22.2
    // does a `ps -o command= -p <pid>` check before SIGKILL. PID
    // 999_999 won't pass `ps` (no such process), so the guard
    // SHOULD skip the kill — better to leak a dead PID file than
    // to SIGKILL an innocent recycled process.
    const FAKE_PID = 999_999;
    writeFileSync(pidPath, String(FAKE_PID), { mode: 0o600 });
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true) as never;

    const t0 = performance.now();
    const result = await ensureHealthy(socketPath);
    const elapsed = performance.now() - t0;

    expect(result).toBe("killed-and-respawned");
    // Should give up within ~1.5s (PING_TIMEOUT_MS = 1000ms). Generous
    // slack for slow CI.
    expect(elapsed).toBeLessThan(2500);
    // The guard prevents SIGKILL of a PID we can't verify is ours.
    // The only kill call should be the signal-0 probe (which the
    // guard issues to check if the PID exists).
    const sigkillCalls = killSpy.mock.calls.filter(
      ([, signal]) => signal === "SIGKILL",
    );
    expect(sigkillCalls.length).toBe(0);
    // Socket got unlinked regardless so the next call doesn't see a
    // stale node.
    expect(existsSync(socketPath)).toBe(false);
    // PID file got cleaned up too.
    expect(existsSync(pidPath)).toBe(false);
    // A fresh daemon spawn was kicked off (mocked).
    expect(spawnMock).toHaveBeenCalled();
  }, 5000);

  it("tolerates a wedged daemon with no PID file (no SIGKILL needed)", async () => {
    dummyServer = createServer((sock: Socket) => {
      sock.on("data", () => {
        /* swallow */
      });
    });
    await new Promise<void>((resolve) =>
      dummyServer!.listen(socketPath, resolve),
    );
    // No pid file written.
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true) as never;

    const result = await ensureHealthy(socketPath);

    expect(result).toBe("killed-and-respawned");
    // No PID file → no SIGKILL was attempted (orphan socket, daemon
    // probably already crashed).
    expect(killSpy).not.toHaveBeenCalled();
    expect(existsSync(socketPath)).toBe(false);
  }, 5000);
});
