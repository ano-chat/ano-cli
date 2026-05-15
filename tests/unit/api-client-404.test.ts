/**
 * `handleHttpError` 404 parsing — see CLI 2.20.0 §6.2 in the plan.
 *
 * Server's `agent_session_start` returns 404 with a body shaped
 * `{ error, code: "not_opted_in" | "not_found" | ... }` so the CLI can
 * tell "user hasn't opted in" from "feature off / list missing" and
 * print the discovery line only in the former case.
 */
import { describe, it, expect } from "vitest";

import { handleHttpError } from "../../src/core/api-client.js";
import { NotFoundError } from "../../src/core/errors.js";

function res404(body: string): Response {
  return new Response(body, { status: 404 });
}

describe("handleHttpError — 404 body parsing", () => {
  it("extracts `code` when the body is JSON with a code field", async () => {
    const promise = handleHttpError(
      res404(JSON.stringify({ error: "Opt in first.", code: "not_opted_in" })),
    );
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    try {
      await promise;
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).code).toBe("not_opted_in");
    }
  });

  it("leaves code undefined when JSON body has no code field", async () => {
    const promise = handleHttpError(
      res404(JSON.stringify({ error: "Missing." })),
    );
    try {
      await promise;
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).code).toBeUndefined();
    }
  });

  it("leaves code undefined when body is plain text (older server)", async () => {
    const promise = handleHttpError(res404("not found"));
    try {
      await promise;
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).code).toBeUndefined();
    }
  });

  it("leaves code undefined when body is malformed JSON (graceful fallback)", async () => {
    const promise = handleHttpError(res404("{not json"));
    try {
      await promise;
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).code).toBeUndefined();
      // The raw text becomes the error message — useful for debugging.
      expect((err as NotFoundError).message).toBe("{not json");
    }
  });
});
