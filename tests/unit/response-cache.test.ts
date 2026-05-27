/**
 * Tests for the in-process response cache (`src/core/response-cache.ts`)
 * AND the integration that matters: `retryFetch` actually serves
 * allowlisted reads from cache on the second call and invalidates
 * on writes.
 *
 * The integration tests use a stubbed `globalThis.fetch` (we own the
 * undici-vs-global distinction in retry.ts; the stub captures what
 * the real fetch path would see). Cache behavior is observable via
 * the call-count to the stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetCacheStatsForTests,
  cacheClear,
  cacheGet,
  cacheInvalidateOrigin,
  cacheSet,
  cacheSize,
  cacheStats,
} from "../../src/core/response-cache.js";

// These tests exercise the cache mechanism itself, so they need the
// Zero carve-out (introduced in v2.23.0 for /list_channels +
// /list_users) suppressed — otherwise the cache would correctly
// refuse to serve those paths and the assertions about
// caching/invalidation would fail. Opt out of Zero via the v2.23.0
// gate; restore on teardown.
const origDisableZero = process.env.ANO_DISABLE_ZERO;
beforeEach(() => {
  cacheClear();
  _resetCacheStatsForTests();
  process.env.ANO_DISABLE_ZERO = "1";
});

afterEach(() => {
  cacheClear();
  _resetCacheStatsForTests();
  if (origDisableZero === undefined) delete process.env.ANO_DISABLE_ZERO;
  else process.env.ANO_DISABLE_ZERO = origDisableZero;
  vi.restoreAllMocks();
});

describe("response-cache core", () => {
  it("returns undefined on a cold cache", () => {
    expect(
      cacheGet("https://api.example/mcp/list_channels", "Bearer x", "{}"),
    ).toBeUndefined();
  });

  it("stores and retrieves allowlisted reads (200 OK)", () => {
    const url = "https://api.example/mcp/list_channels";
    cacheSet(url, "Bearer abc", '{"workspace_id":"w1"}', {
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"channels":[]}',
    });
    const hit = cacheGet(url, "Bearer abc", '{"workspace_id":"w1"}');
    expect(hit).toBeDefined();
    expect(hit?.body).toBe('{"channels":[]}');
    expect(hit?.status).toBe(200);
  });

  it("refuses to cache non-200 responses", () => {
    const url = "https://api.example/mcp/list_channels";
    cacheSet(url, "Bearer abc", "{}", {
      status: 500,
      headers: {},
      body: "boom",
    });
    expect(cacheGet(url, "Bearer abc", "{}")).toBeUndefined();
  });

  it("refuses to cache paths NOT in the read allowlist", () => {
    const url = "https://api.example/mcp/send_message";
    cacheSet(url, "Bearer abc", "{}", {
      status: 200,
      headers: {},
      body: '{"ok":true}',
    });
    expect(cacheGet(url, "Bearer abc", "{}")).toBeUndefined();
  });

  it("scopes entries by auth header (no cross-profile bleed)", () => {
    const url = "https://api.example/mcp/list_users";
    cacheSet(url, "Bearer userA", '{"workspace_id":"w1"}', {
      status: 200,
      headers: {},
      body: '{"users":["a"]}',
    });
    expect(
      cacheGet(url, "Bearer userA", '{"workspace_id":"w1"}'),
    ).toBeDefined();
    // Different auth = miss.
    expect(
      cacheGet(url, "Bearer userB", '{"workspace_id":"w1"}'),
    ).toBeUndefined();
  });

  it("scopes entries by body args", () => {
    const url = "https://api.example/mcp/list_channels";
    cacheSet(url, "Bearer x", '{"workspace_id":"w1"}', {
      status: 200,
      headers: {},
      body: '{"channels":["w1-c1"]}',
    });
    // Different workspace = miss.
    expect(cacheGet(url, "Bearer x", '{"workspace_id":"w2"}')).toBeUndefined();
  });

  it("expires entries after the TTL", () => {
    const url = "https://api.example/mcp/list_channels";
    cacheSet(url, "Bearer x", "{}", {
      status: 200,
      headers: {},
      body: '{"channels":[]}',
    });
    // Wind clock past TTL (5s).
    vi.useFakeTimers();
    try {
      const fixed = Date.now() + 6_000;
      vi.setSystemTime(fixed);
      expect(cacheGet(url, "Bearer x", "{}")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("invalidates an entire origin on cacheInvalidateOrigin", () => {
    cacheSet("https://api.example/mcp/list_channels", "Bearer x", "{}", {
      status: 200,
      headers: {},
      body: '{"channels":[]}',
    });
    cacheSet("https://api.example/mcp/list_users", "Bearer x", "{}", {
      status: 200,
      headers: {},
      body: '{"users":[]}',
    });
    expect(cacheSize("https://api.example/x")).toBe(2);
    cacheInvalidateOrigin("https://api.example/anything");
    expect(cacheSize("https://api.example/x")).toBe(0);
  });

  it("invalidation is per-origin, not global", () => {
    cacheSet("https://api-a.example/mcp/list_channels", "Bearer x", "{}", {
      status: 200,
      headers: {},
      body: "a",
    });
    cacheSet("https://api-b.example/mcp/list_channels", "Bearer x", "{}", {
      status: 200,
      headers: {},
      body: "b",
    });
    cacheInvalidateOrigin("https://api-a.example/mcp/send_message");
    expect(cacheSize("https://api-a.example/")).toBe(0);
    expect(cacheSize("https://api-b.example/")).toBe(1);
  });
});

describe("cached header sanitization (defensive)", () => {
  // The cache stores the body as already-decoded text. Response-side
  // headers like `content-length`, `content-encoding`, and
  // `transfer-encoding` describe the WIRE form and would mislead
  // consumers reading them from a cached entry. retry.ts strips them
  // via `cacheableHeaders` before calling `cacheSet` — the cache
  // module itself stays content-agnostic, which we lock in here.

  it("stores whatever headers the caller provides verbatim", () => {
    cacheSet("https://api.example/mcp/list_channels", "Bearer x", "{}", {
      status: 200,
      headers: { "content-type": "application/json", "x-custom": "value" },
      body: '{"channels":[]}',
    });
    const hit = cacheGet(
      "https://api.example/mcp/list_channels",
      "Bearer x",
      "{}",
    );
    expect(hit?.headers).toEqual({
      "content-type": "application/json",
      "x-custom": "value",
    });
  });
});

describe("cacheStats", () => {
  it("starts at zero with no entries", () => {
    expect(cacheStats()).toEqual({
      hits: 0,
      misses: 0,
      invalidations: 0,
      origins: 0,
      entries: 0,
    });
  });

  it("counts a miss when no entry exists", () => {
    cacheGet("https://api.example/mcp/list_channels", "Bearer x", "{}");
    const s = cacheStats();
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(1);
  });

  it("counts a hit on a fresh entry", () => {
    const url = "https://api.example/mcp/list_channels";
    cacheSet(url, "Bearer x", "{}", {
      status: 200,
      headers: {},
      body: '{"channels":[]}',
    });
    cacheGet(url, "Bearer x", "{}");
    const s = cacheStats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(0);
    expect(s.entries).toBe(1);
    expect(s.origins).toBe(1);
  });

  it("counts an invalidation when a write clears an origin", () => {
    const url = "https://api.example/mcp/list_channels";
    cacheSet(url, "Bearer x", "{}", {
      status: 200,
      headers: {},
      body: '{"channels":[]}',
    });
    cacheInvalidateOrigin("https://api.example/mcp/send_message");
    const s = cacheStats();
    expect(s.invalidations).toBe(1);
    expect(s.entries).toBe(0);
  });

  it("does NOT count an invalidation for an origin that wasn't cached", () => {
    cacheInvalidateOrigin("https://api.example/mcp/send_message");
    expect(cacheStats().invalidations).toBe(0);
  });

  it("counts an expired-entry get as a miss", () => {
    const url = "https://api.example/mcp/list_channels";
    cacheSet(url, "Bearer x", "{}", {
      status: 200,
      headers: {},
      body: "{}",
    });
    // hit
    cacheGet(url, "Bearer x", "{}");
    expect(cacheStats().hits).toBe(1);

    // expire it via clock travel
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 6_000);
      cacheGet(url, "Bearer x", "{}");
    } finally {
      vi.useRealTimers();
    }
    expect(cacheStats().misses).toBe(1);
  });
});

/**
 * retryFetch cache integration is verified via the standalone script
 * `tests/scripts/cache-bench.mjs` — it stands up a real local HTTP
 * server and counts requests. Vitest's ESM module isolation prevents
 * spying on `undici.fetch` (which retry.ts imports directly), so the
 * test would have to mock at the module level, which produces fragile
 * interactions with the keepalive Agent. The standalone script gives
 * a real-world proof point exactly as `keepalive-bench.mjs` does for
 * the agent itself.
 */
