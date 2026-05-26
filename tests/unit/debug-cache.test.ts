/**
 * Tests for the ANO_DEBUG_CACHE stderr telemetry. The flag is read
 * once and memoized, so the suite resets the memo before each test
 * via `_resetDebugCacheForTests`.
 *
 * We don't exercise the actual fetch here — the integration is
 * already covered by cache-bench.mjs. What matters in vitest is that
 * the env-var gate works, that disabled mode prints nothing, and that
 * enabled mode prints to stderr (verified by spying on
 * process.stderr.write).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _originalFetchImpl,
  _resetDebugCacheForTests,
  _setFetchImplForTests,
  retryFetch,
} from "../../src/bridge/retry.js";
import {
  _resetCacheStatsForTests,
  cacheClear,
} from "../../src/core/response-cache.js";

beforeEach(() => {
  delete process.env.ANO_DEBUG_CACHE;
  _resetDebugCacheForTests();
  cacheClear();
  _resetCacheStatsForTests();
});

afterEach(() => {
  delete process.env.ANO_DEBUG_CACHE;
  _resetDebugCacheForTests();
  vi.restoreAllMocks();
  _setFetchImplForTests(_originalFetchImpl);
});

describe("ANO_DEBUG_CACHE telemetry", () => {
  it("prints nothing to stderr when the env var is unset", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    _setFetchImplForTests(
      async () => new Response('{"ok":true}', { status: 200 }),
    );

    await retryFetch("https://api.example/mcp/list_channels", {
      method: "POST",
      headers: { Authorization: "Bearer x" },
      body: '{"workspace_id":"w1"}',
    });

    const cacheLogs = writes.filter((w) => w.includes("[ano:cache]"));
    expect(cacheLogs).toEqual([]);
  });

  it("prints HIT/MISS lines to stderr when ANO_DEBUG_CACHE=1", async () => {
    process.env.ANO_DEBUG_CACHE = "1";
    _resetDebugCacheForTests();

    const writes: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    _setFetchImplForTests(
      async () => new Response('{"channels":[]}', { status: 200 }),
    );

    // First call: MISS (fetches + caches).
    await retryFetch("https://api.example/mcp/list_channels", {
      method: "POST",
      headers: { Authorization: "Bearer x" },
      body: '{"workspace_id":"w1"}',
    });
    // Second call: HIT (served from cache).
    await retryFetch("https://api.example/mcp/list_channels", {
      method: "POST",
      headers: { Authorization: "Bearer x" },
      body: '{"workspace_id":"w1"}',
    });

    const cacheLogs = writes.filter((w) => w.includes("[ano:cache]"));
    expect(cacheLogs.length).toBe(2);
    expect(cacheLogs[0]).toMatch(/\[ano:cache\] MISS \/mcp\/list_channels/);
    expect(cacheLogs[1]).toMatch(/\[ano:cache\] HIT  \/mcp\/list_channels/);
  });

  it("prints a WRITE line for non-cacheable POST endpoints", async () => {
    process.env.ANO_DEBUG_CACHE = "true"; // also accepts "true"
    _resetDebugCacheForTests();

    const writes: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    _setFetchImplForTests(
      async () => new Response('{"ok":true}', { status: 200 }),
    );

    await retryFetch("https://api.example/mcp/send_message", {
      method: "POST",
      headers: { Authorization: "Bearer x" },
      body: '{"channel_id":"c1","text":"hi"}',
    });

    const cacheLogs = writes.filter((w) => w.includes("[ano:cache]"));
    expect(cacheLogs.length).toBe(1);
    expect(cacheLogs[0]).toMatch(/\[ano:cache\] WRITE \/mcp\/send_message/);
  });
});
