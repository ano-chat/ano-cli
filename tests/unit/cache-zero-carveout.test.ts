/**
 * Phase 2 carve-out: when `ANO_USE_ZERO=1`, the response cache must
 * NOT serve `/list_channels` and `/list_users` from its 5s TTL store.
 * Those endpoints are Zero-backed; the REST path only fires on Zero
 * miss, and in that case we want a fresh server read, not a stale
 * cached value that would mask the Zero outage.
 *
 * When `ANO_USE_ZERO` is unset, behavior is unchanged — cache fires
 * for the same paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _originalFetchImpl,
  _setFetchImplForTests,
  retryFetch,
} from "../../src/bridge/retry.js";
import {
  _resetCacheStatsForTests,
  cacheClear,
  cacheStats,
} from "../../src/core/response-cache.js";

const origEnv = process.env.ANO_USE_ZERO;

beforeEach(() => {
  cacheClear();
  _resetCacheStatsForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  _setFetchImplForTests(_originalFetchImpl);
  cacheClear();
  _resetCacheStatsForTests();
  if (origEnv === undefined) delete process.env.ANO_USE_ZERO;
  else process.env.ANO_USE_ZERO = origEnv;
});

describe("cache Zero-carveout", () => {
  it("does NOT cache /list_channels when ANO_USE_ZERO=1", async () => {
    process.env.ANO_USE_ZERO = "1";
    let fetchCalls = 0;
    _setFetchImplForTests(async () => {
      fetchCalls++;
      return new Response('{"channels":[]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await retryFetch("https://api.example/mcp/list_channels", {
      method: "POST",
      headers: { Authorization: "Bearer x" },
      body: "{}",
    });
    await retryFetch("https://api.example/mcp/list_channels", {
      method: "POST",
      headers: { Authorization: "Bearer x" },
      body: "{}",
    });

    // Both calls reach the server — no cache hit on the second.
    expect(fetchCalls).toBe(2);
    expect(cacheStats().entries).toBe(0);
  });

  it("DOES cache /list_channels when Zero is OFF (default behavior)", async () => {
    delete process.env.ANO_USE_ZERO;
    let fetchCalls = 0;
    _setFetchImplForTests(async () => {
      fetchCalls++;
      return new Response('{"channels":[]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await retryFetch("https://api.example/mcp/list_channels", {
      method: "POST",
      headers: { Authorization: "Bearer x" },
      body: "{}",
    });
    await retryFetch("https://api.example/mcp/list_channels", {
      method: "POST",
      headers: { Authorization: "Bearer x" },
      body: "{}",
    });

    // Second call is a cache hit — only one server roundtrip.
    expect(fetchCalls).toBe(1);
    expect(cacheStats().hits).toBe(1);
    expect(cacheStats().entries).toBe(1);
  });

  it("still caches non-Zero-backed paths (/list_workspaces) when ANO_USE_ZERO=1", async () => {
    process.env.ANO_USE_ZERO = "1";
    let fetchCalls = 0;
    _setFetchImplForTests(async () => {
      fetchCalls++;
      return new Response('{"workspaces":[]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await retryFetch("https://api.example/mcp/list_workspaces", {
      method: "POST",
      headers: { Authorization: "Bearer x" },
      body: "{}",
    });
    await retryFetch("https://api.example/mcp/list_workspaces", {
      method: "POST",
      headers: { Authorization: "Bearer x" },
      body: "{}",
    });

    expect(fetchCalls).toBe(1);
    expect(cacheStats().hits).toBe(1);
  });
});
