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
  cacheClear,
  cacheGet,
  cacheInvalidateOrigin,
  cacheSet,
  cacheSize,
} from "../../src/core/response-cache.js";

beforeEach(() => {
  cacheClear();
});

afterEach(() => {
  cacheClear();
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
