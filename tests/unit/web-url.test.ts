import { describe, it, expect, vi } from "vitest";
import { deriveWebAppUrl, resolveWebAppUrl } from "../../src/core/web-url.js";

describe("deriveWebAppUrl", () => {
  it("maps localhost API to the Vite web port", () => {
    expect(deriveWebAppUrl("http://localhost:3001")).toBe(
      "http://localhost:1420",
    );
    expect(deriveWebAppUrl("http://127.0.0.1:3001")).toBe(
      "http://localhost:1420",
    );
  });

  it("maps api.ano.dev → app.ano.dev", () => {
    expect(deriveWebAppUrl("https://api.ano.dev")).toBe("https://app.ano.dev");
  });

  it("maps api-staging.ano.dev → app-staging.ano.dev", () => {
    expect(deriveWebAppUrl("https://api-staging.ano.dev")).toBe(
      "https://app-staging.ano.dev",
    );
  });

  it("falls back to the origin for unrecognized hosts", () => {
    expect(deriveWebAppUrl("https://example.com/x/y")).toBe(
      "https://example.com",
    );
  });

  it("falls back to localhost:1420 for an unparseable endpoint", () => {
    expect(deriveWebAppUrl("not a url")).toBe("http://localhost:1420");
  });
});

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("resolveWebAppUrl", () => {
  it("returns the server's webAppUrl when present (source of truth)", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ webAppUrl: "https://app.ano.dev" })),
    ) as unknown as typeof fetch;
    const url = await resolveWebAppUrl("https://api.ano.dev", fetchImpl);
    expect(url).toBe("https://app.ano.dev");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.ano.dev/api/min-version",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("strips a trailing slash from the server value", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ webAppUrl: "https://app.ano.dev/" })),
    ) as unknown as typeof fetch;
    expect(await resolveWebAppUrl("https://api.ano.dev", fetchImpl)).toBe(
      "https://app.ano.dev",
    );
  });

  it("derives when the server omits webAppUrl (older server)", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ minDesktopVersion: "0.0.0" })),
    ) as unknown as typeof fetch;
    expect(
      await resolveWebAppUrl("https://api-staging.ano.dev", fetchImpl),
    ).toBe("https://app-staging.ano.dev");
  });

  it("derives on a non-OK response", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({}, false)),
    ) as unknown as typeof fetch;
    expect(await resolveWebAppUrl("https://api.ano.dev", fetchImpl)).toBe(
      "https://app.ano.dev",
    );
  });

  it("derives on a network error / timeout", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.reject(new Error("ECONNREFUSED")),
    ) as unknown as typeof fetch;
    expect(await resolveWebAppUrl("http://localhost:3001", fetchImpl)).toBe(
      "http://localhost:1420",
    );
  });
});
