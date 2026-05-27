import { describe, it, expect } from "vitest";
import { deriveCacheUrl } from "../../src/zero/cache-url.js";

describe("deriveCacheUrl", () => {
  it("maps prod-us API to sync-us", () => {
    expect(deriveCacheUrl("https://api-us.ano.dev")).toBe(
      "https://sync-us.ano.dev",
    );
  });

  it("maps prod-eu API to sync-eu", () => {
    expect(deriveCacheUrl("https://api-eu.ano.dev")).toBe(
      "https://sync-eu.ano.dev",
    );
  });

  it("maps staging API to sync-staging", () => {
    expect(deriveCacheUrl("https://api-staging.ano.dev")).toBe(
      "https://sync-staging.ano.dev",
    );
  });

  it("maps local dev API (127.0.0.1:3001) to zero-cache port 4848", () => {
    expect(deriveCacheUrl("http://127.0.0.1:3001")).toBe(
      "http://127.0.0.1:4848",
    );
  });

  it("maps local dev API (localhost:3001) to zero-cache port 4848", () => {
    expect(deriveCacheUrl("http://localhost:3001")).toBe(
      "http://localhost:4848",
    );
  });

  it("trims trailing slashes before parsing", () => {
    expect(deriveCacheUrl("https://api-us.ano.dev/")).toBe(
      "https://sync-us.ano.dev",
    );
  });

  it("returns null for apex (api.ano.dev) — not a regional endpoint", () => {
    expect(deriveCacheUrl("https://api.ano.dev")).toBeNull();
  });

  it("returns null for unrecognized hostnames", () => {
    expect(deriveCacheUrl("https://example.com")).toBeNull();
  });

  it("returns null for non-URL input", () => {
    expect(deriveCacheUrl("not a url")).toBeNull();
  });

  it("returns null for a different port on localhost", () => {
    expect(deriveCacheUrl("http://localhost:9999")).toBeNull();
  });
});
