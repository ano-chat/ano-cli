import { describe, it, expect } from "vitest";

import { parseDuration } from "../../src/util/parse-duration.js";

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEK = 604_800_000;
const MONTH = 2_592_000_000;
const YEAR = 31_536_000_000;

describe("parseDuration", () => {
  it("parses compact forms", () => {
    expect(parseDuration("30m")).toBe(30 * MIN);
    expect(parseDuration("12h")).toBe(12 * HOUR);
    expect(parseDuration("3d")).toBe(3 * DAY);
    expect(parseDuration("5w")).toBe(5 * WEEK);
    expect(parseDuration("1y")).toBe(YEAR);
  });

  it("parses word forms with explicit space", () => {
    expect(parseDuration("5 weeks")).toBe(5 * WEEK);
    expect(parseDuration("3 days")).toBe(3 * DAY);
    expect(parseDuration("12 hours")).toBe(12 * HOUR);
    expect(parseDuration("1 hour")).toBe(HOUR);
    expect(parseDuration("2 months")).toBe(2 * MONTH);
  });

  it("disambiguates compact M (month) from m (minute)", () => {
    expect(parseDuration("3M")).toBe(3 * MONTH);
    expect(parseDuration("3m")).toBe(3 * MIN);
  });

  it("trims whitespace", () => {
    expect(parseDuration("  5 weeks  ")).toBe(5 * WEEK);
    expect(parseDuration("\t12h\n")).toBe(12 * HOUR);
  });

  it("rejects empty input", () => {
    expect(() => parseDuration("")).toThrow(/Empty duration/);
    expect(() => parseDuration("   ")).toThrow(/Empty duration/);
  });

  it("rejects unparseable input", () => {
    expect(() => parseDuration("garbage")).toThrow(/Couldn't parse/);
    expect(() => parseDuration("5 fortnights")).toThrow(/Unknown unit/);
    expect(() => parseDuration("0.5d")).toThrow(/Couldn't parse/);
  });

  it("rejects zero", () => {
    expect(() => parseDuration("0d")).toThrow(/positive/);
  });

  it("rejects unknown units", () => {
    expect(() => parseDuration("5q")).toThrow(/Unknown unit/);
  });
});
