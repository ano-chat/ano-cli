import { describe, it, expect } from "vitest";
import { renderTable } from "../../src/util/table.js";

describe("renderTable", () => {
  it("renders a basic GFM table", () => {
    const rows = [
      { name: "alice", role: "admin" },
      { name: "bob", role: "member" },
    ];
    const result = renderTable(rows, ["name", "role"]);
    const lines = result.split("\n");

    expect(lines).toHaveLength(4); // header + separator + 2 rows
    expect(lines[0]).toContain("name");
    expect(lines[0]).toContain("role");
    // separator line should use dashes
    expect(lines[1]).toMatch(/^-+\s*\|\s*-+$/);
    expect(lines[2]).toContain("alice");
    expect(lines[2]).toContain("admin");
    expect(lines[3]).toContain("bob");
    expect(lines[3]).toContain("member");
  });

  it("returns (empty) for empty array", () => {
    expect(renderTable([], ["name"])).toBe("(empty)");
  });

  it("handles missing columns with empty string", () => {
    const rows = [{ name: "alice" }];
    const result = renderTable(rows, ["name", "email"]);
    const lines = result.split("\n");

    // The row should have name filled, email empty
    expect(lines[2]).toContain("alice");
    // email column should be padded but empty
    expect(lines[0]).toContain("email");
  });

  it("pads columns to widest value", () => {
    const rows = [
      { id: "1", name: "a]" },
      { id: "2", name: "longername" },
    ];
    const result = renderTable(rows, ["id", "name"]);
    const lines = result.split("\n");

    // header "name" is 4 chars, "longername" is 10, so column should be 10-wide
    // separator dashes for name column should be 10 chars
    const separatorParts = lines[1].split(" | ");
    expect(separatorParts[1].length).toBe("longername".length);
  });

  it("handles values with pipe characters", () => {
    const rows = [{ col: "a|b" }];
    const result = renderTable(rows, ["col"]);
    // Should still render without breaking (pipe is in value, not delimiter)
    expect(result).toContain("a|b");
  });

  it("converts non-string values to strings", () => {
    const rows = [{ count: 42, active: true, empty: null }];
    const result = renderTable(
      rows as unknown as Record<string, unknown>[],
      ["count", "active", "empty"],
    );
    expect(result).toContain("42");
    expect(result).toContain("true");
    // null should become empty string
    const lines = result.split("\n");
    expect(lines.length).toBe(3);
  });
});
