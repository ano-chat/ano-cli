/**
 * Tests for daemon-startup endpoint pre-warm (`prewarmDefaultEndpoint`
 * inside `startDaemon`). The integration that matters: when the daemon
 * starts and a credentials file exists, it fires one HEAD request
 * against the resolved endpoint so the first dispatch skips TLS
 * handshake.
 *
 * We can't easily hook into the agent's connection pool from outside,
 * so we test via observable side effect: spin up an in-process HTTP
 * server, point `ANO_ENDPOINT` at it, start the daemon WITHOUT
 * `skipPrewarm`, and confirm the server saw a HEAD request within a
 * short window.
 *
 * This is the load-bearing assertion: if pre-warm is broken, the
 * server sees no request. The actual *timing* benefit (cold first
 * call saves ~200ms transatlantic) is hard to assert in-process — it
 * only shows up against real remote endpoints. That's documented in
 * the design comment on `prewarmConnection`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../../src/daemon/server.js";

let server: Server;
let origin: string;
let observed: string[] = [];
let tempDir: string;
let stop: (() => void) | null = null;

beforeEach(async () => {
  observed = [];
  server = createServer((req, res) => {
    observed.push(`${req.method} ${req.url}`);
    res.writeHead(200);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${addr.port}`;
  tempDir = mkdtempSync(join(tmpdir(), "ano-daemon-prewarm-"));
});

afterEach(async () => {
  if (stop) {
    try {
      stop();
    } catch {
      // ignore
    }
    stop = null;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  delete process.env.ANO_ENDPOINT;
});

describe("daemon startup pre-warm", () => {
  it("fires a HEAD request against ANO_ENDPOINT on listen", async () => {
    process.env.ANO_ENDPOINT = origin;
    const socketPath = join(tempDir, "test.sock");
    const pidPath = `${socketPath}.pid`;
    const handle = startDaemon({
      socketPath,
      pidPath,
      idleMs: 0,
      // explicit: we WANT pre-warm to run
      skipPrewarm: false,
    });
    stop = handle.shutdown;

    // The HEAD is fire-and-forget after listen. Give it up to 2s.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && observed.length === 0) {
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(observed.length).toBeGreaterThanOrEqual(1);
    expect(observed[0]).toMatch(/^HEAD /);
  }, 5000);

  it("skips pre-warm cleanly when skipPrewarm: true", async () => {
    process.env.ANO_ENDPOINT = origin;
    const socketPath = join(tempDir, "test2.sock");
    const pidPath = `${socketPath}.pid`;
    const handle = startDaemon({
      socketPath,
      pidPath,
      idleMs: 0,
      skipPrewarm: true,
    });
    stop = handle.shutdown;

    // No pre-warm should fire. Wait the same window the positive test
    // uses to be sure we're not just looking too early.
    await new Promise((r) => setTimeout(r, 500));
    expect(observed).toEqual([]);
  }, 5000);

  it("doesn't crash when no endpoint can be resolved", async () => {
    // No ANO_ENDPOINT, no creds in this temp HOME → resolution
    // returns undefined, prewarmDefaultEndpoint returns silently.
    const oldHome = process.env.HOME;
    process.env.HOME = tempDir;
    process.env.XDG_CONFIG_HOME = tempDir;
    try {
      const socketPath = join(tempDir, "test3.sock");
      const pidPath = `${socketPath}.pid`;
      const handle = startDaemon({
        socketPath,
        pidPath,
        idleMs: 0,
        skipPrewarm: false,
      });
      stop = handle.shutdown;
      // Wait the window; should NOT hit our server.
      await new Promise((r) => setTimeout(r, 500));
      expect(observed).toEqual([]);
    } finally {
      process.env.HOME = oldHome;
      delete process.env.XDG_CONFIG_HOME;
    }
  }, 5000);
});
