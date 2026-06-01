import { describe, expect, it } from "vitest";
import { AnoCliError } from "../../../core/errors.js";
import {
  normalizeRecipients,
  parseDmLimit,
  parseDmRecipients,
  toDmRequest,
} from "./recipients.js";

describe("normalizeRecipients", () => {
  it("dedupes repeated and comma-separated values", () => {
    expect(normalizeRecipients(["Alice,Bob", "Alice", " Carol "])).toEqual([
      "Alice",
      "Bob",
      "Carol",
    ]);
  });
});

describe("parseDmLimit", () => {
  it("accepts whole numbers in range", () => {
    expect(parseDmLimit("25")).toBe(25);
  });

  it("rejects partial numeric values", () => {
    expect(() => parseDmLimit("10abc")).toThrow(AnoCliError);
  });
});

describe("parseDmRecipients", () => {
  it("accepts a positional recipient", () => {
    expect(parseDmRecipients({ target: "Alice" })).toMatchObject({
      names: ["Alice"],
      ids: [],
      total: 1,
      isGroup: false,
    });
  });

  it("combines positional and --to values for group DMs", () => {
    expect(
      parseDmRecipients({ target: "Alice", to: ["Bob,Carol"] }),
    ).toMatchObject({
      names: ["Alice", "Bob", "Carol"],
      isGroup: true,
      total: 3,
    });
  });

  it("rejects missing recipients with usage exit code", () => {
    expect(() => parseDmRecipients({})).toThrow(AnoCliError);
    try {
      parseDmRecipients({});
    } catch (err) {
      expect((err as AnoCliError).exitCode).toBe(1);
    }
  });

  it("rejects email with group recipients", () => {
    expect(() =>
      parseDmRecipients({ email: "a@example.com", to: ["Bob"] }),
    ).toThrow(/--email is only supported/);
  });
});

describe("toDmRequest", () => {
  it("builds the singular request shape", () => {
    expect(toDmRequest(parseDmRecipients({ target: "Alice" }))).toEqual({
      recipient_name: "Alice",
      recipient_email: undefined,
      user_id: undefined,
    });
  });

  it("builds the group request shape", () => {
    expect(
      toDmRequest(parseDmRecipients({ to: ["Alice", "Bob"], userId: ["u-1"] })),
    ).toEqual({
      recipient_names: ["Alice", "Bob"],
      user_ids: ["u-1"],
    });
  });
});
