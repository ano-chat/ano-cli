/**
 * Tests for the shared keepalive HTTP agent (`src/core/http-agent.ts`).
 *
 * These tests verify the *wiring*: the agent exists, it's the same
 * instance across importers, `retryFetch` passes it to the fetch call,
 * `prewarmConnection` is safely best-effort. They do NOT verify socket
 * reuse — that's a network-level property that vitest's environment
 * (whatever it does to fetch/undici internally) reliably breaks even
 * though the production code works perfectly outside vitest.
 *
 * Real socket-reuse verification lives in `tests/scripts/keepalive-bench.mjs`
 * — a standalone node script that runs the same scenario against a
 * local http server and asserts the connection count. Run it manually
 * or as part of CI integration:
 *
 *     node tests/scripts/keepalive-bench.mjs
 *
 * That script is the load-bearing proof that keepalive actually works.
 * If it fails, keepalive is broken in production too. If the unit
 * tests below fail, the wiring is broken.
 */
import { describe, expect, it } from "vitest";
import { Agent } from "undici";
import {
  sharedHttpAgent,
  prewarmConnection,
} from "../../src/core/http-agent.js";

describe("sharedHttpAgent", () => {
  it("is an undici Agent instance", () => {
    expect(sharedHttpAgent).toBeInstanceOf(Agent);
  });

  it("is a singleton — re-importing yields the same reference", async () => {
    const reimport = await import("../../src/core/http-agent.js");
    expect(reimport.sharedHttpAgent).toBe(sharedHttpAgent);
  });
});

describe("retryFetch passes the agent through", () => {
  it("includes `dispatcher: sharedHttpAgent` in the fetch init by default", async () => {
    // Stub global fetch to capture the init argument.
    let captured: RequestInit | undefined;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      captured = init;
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    try {
      const { retryFetch } = await import("../../src/bridge/retry.js");
      const r = await retryFetch("http://127.0.0.1:1/test", {});
      expect(r.ok).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }

    expect(captured).toBeDefined();
    // The dispatcher field isn't in standard RequestInit; cast to read.
    const dispatcher = (captured as { dispatcher?: unknown }).dispatcher;
    expect(dispatcher).toBe(sharedHttpAgent);
  });

  it("respects a caller-supplied dispatcher (override path)", async () => {
    let captured: RequestInit | undefined;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      captured = init;
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const fakeDispatcher = {
      destroy: () => Promise.resolve(),
    } as unknown as Agent;

    try {
      const { retryFetch } = await import("../../src/bridge/retry.js");
      await retryFetch("http://127.0.0.1:1/test", {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dispatcher: fakeDispatcher as any,
      } as RequestInit);
    } finally {
      globalThis.fetch = origFetch;
    }

    const dispatcher = (captured as { dispatcher?: unknown }).dispatcher;
    expect(dispatcher).toBe(fakeDispatcher);
  });
});

describe("prewarmConnection", () => {
  it("swallows errors silently on an unreachable origin", async () => {
    // Port 1 is reserved + unrouteable on most systems.
    const start = Date.now();
    await prewarmConnection("http://127.0.0.1:1");
    const elapsed = Date.now() - start;
    // Bounded by the 2s deadline + slack for slow CI.
    expect(elapsed).toBeLessThan(4000);
  });

  it("resolves even when given a malformed origin", async () => {
    // Should not throw; URL construction is wrapped in try/catch.
    await expect(prewarmConnection("not-a-url")).resolves.toBeUndefined();
  });
});
