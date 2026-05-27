/**
 * Tests for the Zero JWT auth provider. Mints, caches, refreshes
 * proactively, force-refreshes on demand. We mock `fetch` to avoid
 * standing up a real HTTP endpoint; the contract is small (a single
 * POST to `/api/cli/zero-jwt`) so the mock fidelity is high.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createZeroAuthProvider } from "../../src/zero/auth.js";

function buildMockFetch(opts: {
  responses: Array<{
    status: number;
    body: { token?: string; expires_at?: number } | string;
  }>;
}) {
  let i = 0;
  return vi.fn(async () => {
    const r = opts.responses[i++];
    if (!r) throw new Error("mock fetch exhausted");
    const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(body, {
      status: r.status,
      headers:
        typeof r.body === "string"
          ? {}
          : { "content-type": "application/json" },
    });
  });
}

const SOON = Date.now() + 12 * 60 * 60 * 1000; // 12h from now

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createZeroAuthProvider", () => {
  it("mints on first getAuth and caches the result", async () => {
    const fetchImpl = buildMockFetch({
      responses: [{ status: 200, body: { token: "JWT-A", expires_at: SOON } }],
    });
    const provider = createZeroAuthProvider({
      apiBaseUrl: "https://api.example",
      apiKey: "ano_usr_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(await provider.getAuth()).toBe("JWT-A");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Second call uses cache, no new fetch.
    expect(await provider.getAuth()).toBe("JWT-A");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns undefined and clears cache when mint fails (HTTP 401)", async () => {
    const fetchImpl = buildMockFetch({
      responses: [{ status: 401, body: { token: undefined } }],
    });
    const provider = createZeroAuthProvider({
      apiBaseUrl: "https://api.example",
      apiKey: "ano_usr_revoked",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(await provider.getAuth()).toBeUndefined();
    expect(provider._peekCached()).toBeNull();
  });

  it("forceRefresh discards cache and mints anew", async () => {
    const fetchImpl = buildMockFetch({
      responses: [
        { status: 200, body: { token: "JWT-OLD", expires_at: SOON } },
        { status: 200, body: { token: "JWT-NEW", expires_at: SOON + 1000 } },
      ],
    });
    const provider = createZeroAuthProvider({
      apiBaseUrl: "https://api.example",
      apiKey: "ano_usr_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(await provider.getAuth()).toBe("JWT-OLD");
    expect(await provider.forceRefresh()).toBe("JWT-NEW");
    // Subsequent getAuth uses the fresh cached value.
    expect(await provider.getAuth()).toBe("JWT-NEW");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("proactively refreshes when token is past 80% of lifetime", async () => {
    // The provider approximates issued_at as expires_at - 12h.
    // Refresh threshold = issued_at + 80% × 12h = expires_at - 2.4h.
    // We set expires_at such that current time is BEYOND that threshold
    // but BEFORE the actual expiry.
    const now = Date.now();
    const expiresIn1h = now + 1 * 60 * 60 * 1000;

    const fetchImpl = buildMockFetch({
      responses: [
        { status: 200, body: { token: "JWT-STALE", expires_at: expiresIn1h } },
        // Force-refresh produces a new one.
        {
          status: 200,
          body: { token: "JWT-FRESH", expires_at: now + 12 * 60 * 60 * 1000 },
        },
      ],
    });
    const provider = createZeroAuthProvider({
      apiBaseUrl: "https://api.example",
      apiKey: "ano_usr_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // First call: mints JWT-STALE (which is already past the 80%
    // threshold because we set expires_at=now+1h, implying issued
    // 11h ago).
    expect(await provider.getAuth()).toBe("JWT-STALE");
    // Second call: detects stale → re-mints.
    expect(await provider.getAuth()).toBe("JWT-FRESH");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("invokes the logger on mint + failure", async () => {
    const log = vi.fn();
    const fetchImpl = buildMockFetch({
      responses: [
        { status: 200, body: { token: "JWT-A", expires_at: SOON } },
        { status: 500, body: "boom" },
      ],
    });
    const provider = createZeroAuthProvider({
      apiBaseUrl: "https://api.example",
      apiKey: "ano_usr_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log,
    });
    await provider.getAuth();
    expect(log).toHaveBeenCalledWith(
      "zero-auth: minted",
      expect.objectContaining({ ttl_seconds: expect.any(Number) }),
    );
    log.mockClear();

    provider._clear();
    await provider.getAuth();
    expect(log).toHaveBeenCalledWith(
      "zero-auth: mint failed",
      expect.objectContaining({ message: expect.stringContaining("HTTP 500") }),
    );
  });

  it("rejects responses with malformed shape", async () => {
    const fetchImpl = buildMockFetch({
      responses: [{ status: 200, body: { token: undefined } }],
    });
    const provider = createZeroAuthProvider({
      apiBaseUrl: "https://api.example",
      apiKey: "ano_usr_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await provider.getAuth()).toBeUndefined();
  });
});
