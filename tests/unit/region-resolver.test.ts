import { describe, it, expect, vi } from "vitest";
import {
  resolveRoute,
  shouldResolveRoute,
} from "../../src/core/region-resolver.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("shouldResolveRoute", () => {
  it("returns true for the CF Worker apex hostname", () => {
    expect(shouldResolveRoute("https://api.ano.dev")).toBe(true);
    expect(shouldResolveRoute("https://api.ano.dev/")).toBe(true);
  });

  it("returns false for already-regional endpoints", () => {
    expect(shouldResolveRoute("https://api-us.ano.dev")).toBe(false);
    expect(shouldResolveRoute("https://api-eu.ano.dev")).toBe(false);
  });

  it("returns false for staging endpoints", () => {
    expect(shouldResolveRoute("https://api-staging.ano.dev")).toBe(false);
  });

  it("returns false for localhost / dev endpoints", () => {
    expect(shouldResolveRoute("http://localhost:3001")).toBe(false);
  });
});

describe("resolveRoute", () => {
  it("returns the regional apiUrl from a 200 JSON response", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        region: "eu",
        apiUrl: "https://api-eu.ano.dev",
        syncUrl: "https://sync-eu.ano.dev",
        source: "cf-ipcountry",
      }),
    );

    const result = await resolveRoute({
      endpoint: "https://api.ano.dev",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({
      region: "eu",
      apiUrl: "https://api-eu.ano.dev",
      source: "cf-ipcountry",
    });
  });

  it("attaches workspace_id query param when provided", async () => {
    let capturedUrl: URL | undefined;
    const fetchImpl = vi.fn(async (input: string | URL) => {
      capturedUrl = input instanceof URL ? input : new URL(input);
      return jsonResponse({
        region: "us",
        apiUrl: "https://api-us.ano.dev",
        syncUrl: "https://sync-us.ano.dev",
        source: "kv",
      });
    });

    await resolveRoute({
      endpoint: "https://api.ano.dev",
      workspaceId: "ws-123",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(capturedUrl?.pathname).toBe("/route");
    expect(capturedUrl?.searchParams.get("workspace_id")).toBe("ws-123");
  });

  it("omits workspace_id when not provided", async () => {
    let capturedUrl: URL | undefined;
    const fetchImpl = vi.fn(async (input: string | URL) => {
      capturedUrl = input instanceof URL ? input : new URL(input);
      return jsonResponse({
        region: "eu",
        apiUrl: "https://api-eu.ano.dev",
        syncUrl: "https://sync-eu.ano.dev",
        source: "cf-ipcountry",
      });
    });

    await resolveRoute({
      endpoint: "https://api.ano.dev",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(capturedUrl?.searchParams.has("workspace_id")).toBe(false);
  });

  it("returns null on non-200 response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const result = await resolveRoute({
      endpoint: "https://api.ano.dev",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network down");
    });
    const result = await resolveRoute({
      endpoint: "https://api.ano.dev",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBeNull();
  });

  it("returns null when body has unexpected region", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ region: "asia", apiUrl: "x", source: "kv" }),
    );
    const result = await resolveRoute({
      endpoint: "https://api.ano.dev",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBeNull();
  });

  it("returns null when body is missing apiUrl", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ region: "us", source: "kv" }),
    );
    const result = await resolveRoute({
      endpoint: "https://api.ano.dev",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBeNull();
  });

  it("strips trailing slash from returned apiUrl", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        region: "us",
        apiUrl: "https://api-us.ano.dev/",
        syncUrl: "https://sync-us.ano.dev",
        source: "kv",
      }),
    );
    const result = await resolveRoute({
      endpoint: "https://api.ano.dev",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result?.apiUrl).toBe("https://api-us.ano.dev");
  });

  it("aborts after the timeout window", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL, init?: RequestInit) => {
        // Simulate a hung server by waiting for the abort signal.
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      },
    );
    const result = await resolveRoute({
      endpoint: "https://api.ano.dev",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
    });
    expect(result).toBeNull();
  });
});
