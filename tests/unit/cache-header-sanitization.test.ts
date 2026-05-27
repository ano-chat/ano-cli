/**
 * `retryFetch` strips response-only headers (content-length,
 * content-encoding, transfer-encoding, x-request-id, set-cookie, ...)
 * from cached entries before storing them. Replaying those headers on
 * a synthesized Response (whose body is already-decoded text) would
 * mislead any consumer that reads them: content-length would lie,
 * content-encoding would claim the body is still gzipped, etc.
 *
 * This test mocks the underlying fetch impl to return a response with
 * every dangerous header set, lets retryFetch cache it, then reads
 * back via a second call (cache hit) and verifies the synthesized
 * Response only carries the allowlisted headers (content-type).
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
} from "../../src/core/response-cache.js";

// These tests exercise cached responses for /list_channels. With
// v2.23.0's default-on Zero, that path skips the cache — so the
// "cache hit" assertions would fail. Opt out for this suite.
const origDisableZero = process.env.ANO_DISABLE_ZERO;
beforeEach(() => {
  cacheClear();
  _resetCacheStatsForTests();
  process.env.ANO_DISABLE_ZERO = "1";
});

afterEach(() => {
  vi.restoreAllMocks();
  _setFetchImplForTests(_originalFetchImpl);
  cacheClear();
  _resetCacheStatsForTests();
  if (origDisableZero === undefined) delete process.env.ANO_DISABLE_ZERO;
  else process.env.ANO_DISABLE_ZERO = origDisableZero;
});

describe("cached response header sanitization", () => {
  it("strips content-length / content-encoding / transfer-encoding / x-request-id from cache hits", async () => {
    // The underlying fetch returns a response with all the dangerous
    // headers set. retryFetch will cache it, then the next call
    // should be a hit served from cache — and the synthesized
    // Response from cache must NOT carry the response-only headers.
    _setFetchImplForTests(async () => {
      return new Response('{"channels":[]}', {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "999", // wrong on purpose
          "content-encoding": "gzip", // wrong on purpose
          "transfer-encoding": "chunked", // wrong on purpose
          "x-request-id": "req_abc123", // request-specific, must not leak
          "set-cookie": "sess=secret; HttpOnly", // CRITICAL: must not leak
          date: "Tue, 26 May 2026 19:00:00 GMT", // request-specific
        },
      });
    });

    // First call — fetches + caches.
    await retryFetch("https://api.example/mcp/list_channels", {
      method: "POST",
      headers: { Authorization: "Bearer x" },
      body: '{"workspace_id":"w1"}',
    });

    // Second call — cache HIT. Read all the headers the synthesized
    // Response exposes and assert only content-type is present.
    const r2 = await retryFetch("https://api.example/mcp/list_channels", {
      method: "POST",
      headers: { Authorization: "Bearer x" },
      body: '{"workspace_id":"w1"}',
    });
    const hitHeaders: Record<string, string> = {};
    r2.headers.forEach((v, k) => {
      hitHeaders[k.toLowerCase()] = v;
    });

    expect(hitHeaders["content-type"]).toBe("application/json");
    expect(hitHeaders["content-length"]).toBeUndefined();
    expect(hitHeaders["content-encoding"]).toBeUndefined();
    expect(hitHeaders["transfer-encoding"]).toBeUndefined();
    expect(hitHeaders["x-request-id"]).toBeUndefined();
    // The most important assertion: cookies set by the server on the
    // ORIGINAL response must NEVER replay to a cache hit. (Today this
    // is theoretical because Set-Cookie is rare on /mcp/* reads; the
    // test locks the invariant against future drift.)
    expect(hitHeaders["set-cookie"]).toBeUndefined();
    expect(hitHeaders["date"]).toBeUndefined();
  });

  it("preserves content-type so JSON parsing still works downstream", async () => {
    _setFetchImplForTests(async () => {
      return new Response('{"channels":["c1"]}', {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    });

    await retryFetch("https://api.example/mcp/list_channels", {
      method: "POST",
      headers: { Authorization: "Bearer x" },
      body: '{"workspace_id":"w1"}',
    });
    const r2 = await retryFetch("https://api.example/mcp/list_channels", {
      method: "POST",
      headers: { Authorization: "Bearer x" },
      body: '{"workspace_id":"w1"}',
    });
    expect(r2.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(await r2.text()).toBe('{"channels":["c1"]}');
  });
});
