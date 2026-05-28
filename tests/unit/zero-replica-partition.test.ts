import { describe, it, expect } from "vitest";
import { sanitizeEndpoint } from "../../src/zero/client.js";

/**
 * `sanitizeEndpoint` is the slug derivation that partitions Zero
 * replica files by endpoint. Without partitioning, switching profiles
 * (staging → local, prod-us → prod-eu) reuses the previous
 * environment's local replica because WorkOS issues the same userId
 * across environments. The bug class is silent — wrong data with no
 * error.
 *
 * What matters:
 *   - Different endpoints produce DIFFERENT slugs (no collisions)
 *   - Same endpoint produces the SAME slug (cache stable across runs)
 *   - Output is filesystem-safe (no path-separator chars, no spaces)
 */
describe("sanitizeEndpoint — Zero replica filename slug", () => {
  it("produces distinct slugs for distinct environments", () => {
    const slugs = new Set([
      sanitizeEndpoint("https://sync-staging.ano.dev"),
      sanitizeEndpoint("https://sync-us.ano.dev"),
      sanitizeEndpoint("https://sync-eu.ano.dev"),
      sanitizeEndpoint("http://127.0.0.1:4848"),
      sanitizeEndpoint("http://localhost:4848"),
    ]);
    expect(slugs.size).toBe(5); // no collisions
  });

  it("produces stable output for the same endpoint (deterministic)", () => {
    const a = sanitizeEndpoint("https://sync-staging.ano.dev");
    const b = sanitizeEndpoint("https://sync-staging.ano.dev");
    expect(a).toBe(b);
  });

  it("strips the protocol", () => {
    expect(sanitizeEndpoint("https://sync-us.ano.dev")).toBe("sync-us.ano.dev");
    expect(sanitizeEndpoint("http://sync-us.ano.dev")).toBe("sync-us.ano.dev");
  });

  it("strips trailing slashes", () => {
    expect(sanitizeEndpoint("https://sync-us.ano.dev/")).toBe(
      "sync-us.ano.dev",
    );
    expect(sanitizeEndpoint("https://sync-us.ano.dev///")).toBe(
      "sync-us.ano.dev",
    );
  });

  it("replaces port colons with underscores so the filename is safe on win32", () => {
    expect(sanitizeEndpoint("http://127.0.0.1:4848")).toBe("127.0.0.1_4848");
    expect(sanitizeEndpoint("http://localhost:4848")).toBe("localhost_4848");
  });

  it("output has no path-separator or shell-meta chars", () => {
    const slug = sanitizeEndpoint("https://sync-us.ano.dev");
    expect(slug).not.toMatch(/[/\\:?*"<>|]/);
    // Also no whitespace.
    expect(slug).not.toMatch(/\s/);
  });

  it("staging vs prod-us produce different replica filenames (the bug we're fixing)", () => {
    // Re-stage the bug: same userId across staging + prod-us would
    // produce the same `user_<id>` filename without endpoint
    // partitioning. With it, the suffix diverges.
    const userId = "user_01KG8EFJND7MPERY88E5CJT5QP";
    const stagingName = `user_${userId}_${sanitizeEndpoint("https://sync-staging.ano.dev")}`;
    const prodName = `user_${userId}_${sanitizeEndpoint("https://sync-us.ano.dev")}`;
    expect(stagingName).not.toBe(prodName);
  });
});
