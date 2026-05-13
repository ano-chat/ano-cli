/**
 * Tests for `retryFetch`. Pin the v2.13.2 behaviour: spotless CLI by
 * default — 429 returns immediately so the caller can throw a
 * RateLimitError and exit with code 5; the bridge opts back into the
 * historical retry-with-backoff behaviour via `retryRateLimit: true`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PermanentError, retryFetch } from "../../src/bridge/retry.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockFetch(
  responses: Array<Response | Error>,
): ReturnType<typeof vi.fn> {
  let i = 0;
  const fn = vi.fn(async () => {
    const r = responses[i++];
    if (r instanceof Error) throw r;
    if (!r) throw new Error("mock exhausted");
    return r;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function jsonResponse(
  status: number,
  body = "",
  headers?: Record<string, string>,
): Response {
  return new Response(body, { status, headers });
}

describe("retryFetch — 429 (rate limit)", () => {
  it("returns the 429 response immediately by default (no retry)", async () => {
    const fetchMock = mockFetch([jsonResponse(429, "rate limited")]);
    const res = await retryFetch("http://x/", {});
    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retries
  });

  it("does NOT sleep before returning 429 (caller decides backoff)", async () => {
    mockFetch([jsonResponse(429)]);
    const start = Date.now();
    await retryFetch("http://x/", {}, { baseDelayMs: 5000 });
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("retries 429 with backoff when retryRateLimit: true (bridge mode)", async () => {
    const fetchMock = mockFetch([
      jsonResponse(429, "", { "Retry-After": "0" }),
      jsonResponse(200, "ok"),
    ]);
    const res = await retryFetch(
      "http://x/",
      {},
      { retryRateLimit: true, baseDelayMs: 1, maxRetries: 3 },
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("respects Retry-After in seconds when retrying 429", async () => {
    mockFetch([
      jsonResponse(429, "", { "Retry-After": "0" }),
      jsonResponse(200),
    ]);
    const start = Date.now();
    const res = await retryFetch(
      "http://x/",
      {},
      { retryRateLimit: true, baseDelayMs: 5000 },
    );
    // Retry-After: 0 → no delay, even though baseDelay would suggest 5 s.
    expect(res.status).toBe(200);
    expect(Date.now() - start).toBeLessThan(100);
  });
});

describe("retryFetch — network errors", () => {
  it("retries network errors up to maxRetries (default 2 = 3 total attempts)", async () => {
    const fetchMock = mockFetch([
      new Error("ECONNREFUSED"),
      new Error("ECONNREFUSED"),
      jsonResponse(200, "ok"),
    ]);
    const res = await retryFetch("http://x/", {}, { baseDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws after maxRetries network failures", async () => {
    mockFetch([
      new Error("ECONNREFUSED"),
      new Error("ECONNREFUSED"),
      new Error("ECONNREFUSED"),
    ]);
    await expect(
      retryFetch("http://x/", {}, { baseDelayMs: 1, maxRetries: 2 }),
    ).rejects.toThrow("ECONNREFUSED");
  });
});

describe("retryFetch — 5xx", () => {
  it("retries 502 with backoff", async () => {
    const fetchMock = mockFetch([
      jsonResponse(502),
      jsonResponse(502),
      jsonResponse(200),
    ]);
    const res = await retryFetch(
      "http://x/",
      {},
      { baseDelayMs: 1, maxRetries: 5 },
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("caps 500 (application error) at 2 retries even when maxRetries is higher", async () => {
    const fetchMock = mockFetch([
      jsonResponse(500),
      jsonResponse(500),
      jsonResponse(500),
      jsonResponse(200),
    ]);
    await expect(
      retryFetch("http://x/", {}, { baseDelayMs: 1, maxRetries: 10 }),
    ).rejects.toThrow("Server error: 500");
    // 1 initial + 2 retries = 3 attempts; the 4th 500 never seen.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("retryFetch — 4xx (other than 429)", () => {
  it("throws PermanentError on 400 with no retry", async () => {
    const fetchMock = mockFetch([jsonResponse(400, "bad request")]);
    await expect(retryFetch("http://x/", {})).rejects.toBeInstanceOf(
      PermanentError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws PermanentError on 404 with no retry", async () => {
    const fetchMock = mockFetch([jsonResponse(404)]);
    try {
      await retryFetch("http://x/", {});
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(PermanentError);
      expect((e as PermanentError).status).toBe(404);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("retryFetch — happy path", () => {
  it("returns immediately on 200", async () => {
    const fetchMock = mockFetch([jsonResponse(200, "ok")]);
    const res = await retryFetch("http://x/", {});
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
