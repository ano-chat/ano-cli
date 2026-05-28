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
    // Refresh threshold = mintedAt + 0.8 × lifetime. We mint a 1h
    // token, then advance the wall clock past the 48-minute mark and
    // expect the next getAuth() to re-mint.
    vi.useFakeTimers();
    const start = new Date("2026-05-28T10:00:00Z").getTime();
    vi.setSystemTime(start);
    const ONE_HOUR = 60 * 60 * 1000;

    const fetchImpl = buildMockFetch({
      responses: [
        {
          status: 200,
          body: { token: "JWT-INITIAL", expires_at: start + ONE_HOUR },
        },
        {
          status: 200,
          body: {
            token: "JWT-FRESH",
            expires_at: start + 50 * 60 * 1000 + ONE_HOUR,
          },
        },
      ],
    });
    const provider = createZeroAuthProvider({
      apiBaseUrl: "https://api.example",
      apiKey: "ano_usr_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // First call mints the initial token; at t=0 it's well within
    // its 80% window (refresh threshold = +48min).
    expect(await provider.getAuth()).toBe("JWT-INITIAL");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Still fresh at +47min.
    vi.setSystemTime(start + 47 * 60 * 1000);
    expect(await provider.getAuth()).toBe("JWT-INITIAL");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Past the 80% threshold (+50min) — next call must re-mint.
    vi.setSystemTime(start + 50 * 60 * 1000);
    expect(await provider.getAuth()).toBe("JWT-FRESH");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("respects the 60s safety floor for short-TTL tokens", async () => {
    // A 30-second token's 80% threshold (+24s) is INSIDE the 60s
    // safety floor (expiresAt - 60s). The floor wins, so the token
    // is treated as stale on the very next call.
    vi.useFakeTimers();
    const start = new Date("2026-05-28T10:00:00Z").getTime();
    vi.setSystemTime(start);
    const THIRTY_SEC = 30 * 1000;
    const ONE_HOUR = 60 * 60 * 1000;

    const fetchImpl = buildMockFetch({
      responses: [
        {
          status: 200,
          body: { token: "JWT-SHORT", expires_at: start + THIRTY_SEC },
        },
        {
          status: 200,
          body: { token: "JWT-LONG", expires_at: start + ONE_HOUR },
        },
      ],
    });
    const provider = createZeroAuthProvider({
      apiBaseUrl: "https://api.example",
      apiKey: "ano_usr_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // First call mints the short token.
    expect(await provider.getAuth()).toBe("JWT-SHORT");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Second call: short token is already within the 60s floor at
    // mint time → re-mint.
    expect(await provider.getAuth()).toBe("JWT-LONG");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
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
