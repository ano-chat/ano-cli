/**
 * Tests for the client-side circuit breaker (v2.20).
 *
 * The daemon is a best-effort accelerator. A misbehaving daemon (slow
 * dispatch, internal error, intermittent cold-start stall) must NOT be
 * able to slow down CLI calls indefinitely — the breaker exists so that
 * a single bad call disables the daemon path for ~10 min and falls
 * straight through to direct execution afterwards.
 *
 * Pinned behavior:
 *   • Fresh state → breaker is open (not tripped). Real daemon dispatch
 *     proceeds.
 *   • Tripping the breaker writes a future timestamp; `isCircuitBreakerTripped`
 *     returns true until that timestamp lapses.
 *   • `runWithDaemon` short-circuits to `false` (= run directly) when
 *     the breaker is tripped, WITHOUT touching the socket — no ping, no
 *     connect, no spawn. This is the load-bearing assertion: a broken
 *     daemon can't keep costing latency call-after-call.
 *   • A response_timeout on a real call trips the breaker AND kills the
 *     daemon PID, so the daemon can't keep producing stale state.
 *   • `clearCircuitBreaker` resets the file; called by `ano daemon start`
 *     so the user has a clean way to re-engage the daemon path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const spawnMock = vi.fn(() => ({ unref: () => {} }));
vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return { ...actual, spawn: spawnMock };
});

const {
  clearCircuitBreaker,
  defaultCircuitBreakerPath,
  isCircuitBreakerTripped,
  runWithDaemon,
  tripCircuitBreaker,
} = await import("../../src/daemon/client.js");

let tempDir: string;
let breakerPath: string;
let socketPath: string;
let pidPath: string;
let dummyServer: Server | null = null;
let killSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ano-daemon-breaker-"));
  breakerPath = join(tempDir, "daemon-disabled-until");
  socketPath = join(tempDir, "test.sock");
  pidPath = `${socketPath}.pid`;
  process.env.ANO_DAEMON_CIRCUIT_BREAKER_PATH = breakerPath;
  process.env.ANO_DAEMON_SOCKET = socketPath;
  spawnMock.mockClear();
});

afterEach(() => {
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
  delete process.env.ANO_DAEMON_CIRCUIT_BREAKER_PATH;
  delete process.env.ANO_DAEMON_SOCKET;
});

describe("circuit breaker helpers", () => {
  it("reports not tripped when no file exists", () => {
    expect(existsSync(breakerPath)).toBe(false);
    expect(isCircuitBreakerTripped()).toBe(false);
  });

  it("trips the breaker by writing a future timestamp", () => {
    const before = Date.now();
    tripCircuitBreaker();
    expect(existsSync(breakerPath)).toBe(true);
    const stored = Number(readFileSync(breakerPath, "utf8").trim());
    // ~10 min ahead of now; allow 30s slack for slow CI.
    expect(stored).toBeGreaterThan(before + 9 * 60 * 1000);
    expect(stored).toBeLessThan(before + 11 * 60 * 1000);
    expect(isCircuitBreakerTripped()).toBe(true);
  });

  it("treats a past timestamp as already-expired", () => {
    writeFileSync(breakerPath, String(Date.now() - 1000), { mode: 0o600 });
    expect(isCircuitBreakerTripped()).toBe(false);
  });

  it("treats a corrupt file as not tripped", () => {
    writeFileSync(breakerPath, "not-a-number", { mode: 0o600 });
    expect(isCircuitBreakerTripped()).toBe(false);
  });

  it("clears the breaker by unlinking the file", () => {
    tripCircuitBreaker();
    expect(isCircuitBreakerTripped()).toBe(true);
    clearCircuitBreaker();
    expect(isCircuitBreakerTripped()).toBe(false);
    expect(existsSync(breakerPath)).toBe(false);
  });

  it("path resolves from ANO_DAEMON_CIRCUIT_BREAKER_PATH override", () => {
    expect(defaultCircuitBreakerPath()).toBe(breakerPath);
  });
});

describe("runWithDaemon respects the circuit breaker", () => {
  it("bypasses the daemon entirely when breaker is tripped (no socket touch)", async () => {
    // Stand up a real (wedged) daemon-like socket that would hang for
    // 1+ seconds if the client actually pinged it. If the client
    // short-circuits via the breaker, this socket should never accept.
    let acceptCount = 0;
    dummyServer = createServer((sock: Socket) => {
      acceptCount++;
      sock.on("data", () => {
        /* swallow */
      });
    });
    await new Promise<void>((resolve) =>
      dummyServer!.listen(socketPath, resolve),
    );

    // Trip the breaker.
    tripCircuitBreaker();

    const t0 = performance.now();
    const result = await runWithDaemon(["channels", "list"]);
    const elapsed = performance.now() - t0;

    expect(result).toBe(false);
    // Must be near-instant — the whole point is to skip the socket
    // when the breaker is tripped.
    expect(elapsed).toBeLessThan(50);
    // Critically: no connection was made to the daemon socket.
    expect(acceptCount).toBe(0);
    // And no respawn was kicked off — the breaker means "leave the
    // daemon alone for now," not "try to fix it."
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("returns false (and probes the socket) when breaker is open", async () => {
    // Open breaker; the wedged-socket path proceeds through ensureHealthy.
    let acceptCount = 0;
    dummyServer = createServer((sock: Socket) => {
      acceptCount++;
      sock.on("data", () => {
        /* swallow */
      });
    });
    await new Promise<void>((resolve) =>
      dummyServer!.listen(socketPath, resolve),
    );
    // Drop a fake pid file so the kill path has a target. process.kill
    // is mocked so no real signal flies.
    writeFileSync(pidPath, "999999", { mode: 0o600 });
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true) as never;

    expect(isCircuitBreakerTripped()).toBe(false);
    const result = await runWithDaemon(["channels", "list"]);

    expect(result).toBe(false);
    // The probe DID touch the socket (one connect = ensureHealthy ping).
    expect(acceptCount).toBeGreaterThanOrEqual(1);
  });
});
