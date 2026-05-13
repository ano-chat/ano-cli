/**
 * Tests for the per-dispatch timeout (v2.13.1).
 *
 * Pre-fix the daemon's serial dispatch chain could deadlock when one
 * dispatch hung indefinitely (server rate-limit retry loops, awaited
 * fetch that never resolved, etc.) — every queued request behind it
 * blocked too. This test pins down the safety net:
 *
 *   • If a dispatch exceeds `dispatchTimeoutMs`, the daemon replies to
 *     the client with `code: "internal"` and an error message
 *     mentioning "restarting".
 *   • The daemon then invokes its shutdown path (via `_onShutdown` in
 *     test mode; in production this is `process.exit(0)` so the next
 *     call respawns a fresh daemon).
 *   • Subsequent fast dispatches NEVER queue behind the hung one — but
 *     since the daemon shuts down, that's tested implicitly via the
 *     shutdown callback firing within a small window after the reply.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROTOCOL_VERSION,
  frame,
  type DaemonResponse,
} from "../../src/daemon/protocol.js";
import { startDaemon } from "../../src/daemon/server.js";

let socketPath: string;
let stop: () => void;
let shutdownCount = 0;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "ano-daemon-timeout-test-"));
  socketPath = join(dir, "test.sock");
  const handle = startDaemon({
    socketPath,
    pidPath: join(dir, "test.pid"),
    idleMs: 0,
    dispatchTimeoutMs: 100, // tight window so the test fires quickly
    // Dispatch hangs forever — simulates a real-world stuck command.
    _dispatchOverride: () => new Promise<never>(() => {}),
    _onShutdown: () => {
      shutdownCount++;
    },
  });
  stop = handle.shutdown;
});

afterAll(() => {
  stop();
});

function call(req: unknown): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const tryOnce = (attempt: number): void => {
      const sock = connect(socketPath);
      let buffer = "";
      let settled = false;
      const t = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          sock.destroy();
        } catch {
          // ignore
        }
        reject(new Error("daemon did not reply within 3s"));
      }, 3000);
      sock.once("connect", () => sock.write(frame(req)));
      sock.setEncoding("utf8");
      sock.on("data", (chunk: string) => {
        buffer += chunk;
        const nl = buffer.indexOf("\n");
        if (nl === -1) return;
        if (settled) return;
        settled = true;
        clearTimeout(t);
        try {
          sock.destroy();
        } catch {
          // ignore
        }
        try {
          resolve(JSON.parse(buffer.slice(0, nl)) as DaemonResponse);
        } catch (e) {
          reject(e);
        }
      });
      sock.on("error", (err: NodeJS.ErrnoException) => {
        if (
          (err.code === "ENOENT" || err.code === "ECONNREFUSED") &&
          attempt < 10
        ) {
          setTimeout(() => tryOnce(attempt + 1), 50);
          return;
        }
        if (settled) return;
        settled = true;
        clearTimeout(t);
        reject(err);
      });
    };
    tryOnce(0);
  });
}

describe("per-dispatch timeout (v2.13.1)", () => {
  it("replies with timeout error within the configured window and triggers shutdown", async () => {
    const startedAt = Date.now();
    const resp = await call({
      method: "exec",
      id: 42,
      v: PROTOCOL_VERSION,
      // Empty string skips the version-mismatch check (truthy guard) so
      // we exercise the dispatch path, not the upgrade path.
      cliVersion: "",
      argv: ["channels", "list", "--agent"],
      cwd: process.cwd(),
      env: {},
    });
    const elapsed = Date.now() - startedAt;

    expect(resp.ok).toBe(false);
    if (resp.ok) return;
    expect(resp.code).toBe("internal");
    expect(resp.error).toMatch(/restarting/);
    // 100 ms timeout + ≤500 ms connect-retry loop + reply-write delay.
    // Generous bound for slow CI; the meaningful assertion is "not 30 s".
    expect(elapsed).toBeLessThan(2000);

    // The shutdown callback fires on a 50 ms post-reply delay. Wait it out.
    await new Promise((r) => setTimeout(r, 200));
    expect(shutdownCount).toBeGreaterThanOrEqual(1);
  });
});
