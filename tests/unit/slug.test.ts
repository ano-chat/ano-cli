import { describe, it, expect } from "vitest";
import { looksLikeSlug, resolveSlugOrId, slugFromId } from "../../src/util/slug.js";

describe("slugFromId", () => {
  it("produces the same slug for the same id (deterministic)", () => {
    const id = "f4b1f964-1613-49b7-af6f-f5d5213692b8";
    expect(slugFromId(id)).toBe(slugFromId(id));
  });

  it("produces a different slug for a different id", () => {
    const a = slugFromId("f4b1f964-1613-49b7-af6f-f5d5213692b8");
    const b = slugFromId("e4325bf0-0bea-4c14-b00b-b497568551f4");
    expect(a).not.toBe(b);
  });

  it("matches the documented adjective-animal-NN shape", () => {
    const slug = slugFromId("f4b1f964-1613-49b7-af6f-f5d5213692b8");
    expect(slug).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);
  });

  it("ignores dash placement and case in the source uuid", () => {
    const id = "F4B1F964-1613-49B7-AF6F-F5D5213692B8";
    const idNoDashes = "f4b1f9641613-49b7af6f-f5d5213692b8";
    expect(slugFromId(id)).toBe(slugFromId(idNoDashes));
  });

  it("handles empty input by returning empty string", () => {
    expect(slugFromId("")).toBe("");
  });

  it("zero-pads the trailing number to two digits", () => {
    // No exhaustive coverage; sanity-check against a known short
    // remainder. The id below mods the number slice down to a small
    // value — important is that the rendered form keeps the leading
    // zero so visual width is stable in lists.
    const slug = slugFromId("00000000-0000-0000-0000-000000000000");
    expect(slug).toMatch(/-00$/);
  });
});

describe("looksLikeSlug", () => {
  it("accepts the canonical adjective-animal-number shape", () => {
    expect(looksLikeSlug("quiet-otter-42")).toBe(true);
    expect(looksLikeSlug("bold-fox-07")).toBe(true);
  });

  it("rejects raw UUIDs", () => {
    expect(looksLikeSlug("f4b1f964-1613-49b7-af6f-f5d5213692b8")).toBe(false);
  });

  it("rejects bare words and short fragments", () => {
    expect(looksLikeSlug("otter")).toBe(false);
    expect(looksLikeSlug("quiet-otter")).toBe(false);
    expect(looksLikeSlug("")).toBe(false);
  });
});

describe("resolveSlugOrId", () => {
  const items = [
    { id: "f4b1f964-1613-49b7-af6f-f5d5213692b8" },
    { id: "e4325bf0-0bea-4c14-b00b-b497568551f4" },
    { id: "11111111-2222-3333-4444-555555555555" },
  ];

  it("matches by raw uuid (fast path)", () => {
    const r = resolveSlugOrId("e4325bf0-0bea-4c14-b00b-b497568551f4", items);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.match.id).toBe("e4325bf0-0bea-4c14-b00b-b497568551f4");
  });

  it("matches by slug derived from one of the ids", () => {
    const targetSlug = slugFromId(items[0].id);
    const r = resolveSlugOrId(targetSlug, items);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.match.id).toBe(items[0].id);
  });

  it("returns not_found when input matches nothing", () => {
    const r = resolveSlugOrId("nonexistent-zebra-99", items);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_found");
  });

  it("flags ambiguous matches when two ids slug to the same string", () => {
    // Synthetic case — give two items the SAME id (rare in practice
    // but the API surface still has to handle it). Easiest way to
    // simulate the collision branch deterministically.
    const collisionItems = [{ id: items[0].id }, { id: items[0].id }];
    const r = resolveSlugOrId(slugFromId(items[0].id), collisionItems);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("ambiguous");
      if (r.reason === "ambiguous") expect(r.matches).toHaveLength(2);
    }
  });

  it("ignores leading/trailing whitespace on the input", () => {
    const r = resolveSlugOrId(`  ${items[0].id}  `, items);
    expect(r.ok).toBe(true);
  });

  it("returns not_found on empty input", () => {
    const r = resolveSlugOrId("", items);
    expect(r.ok).toBe(false);
  });
});
