import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { setActiveZeroClient } from "../../src/zero/active-client.js";
import { archiveChannelViaZero } from "../../src/zero/writes.js";

/**
 * Tests for the Zero-write fallback + server-confirmation semantics.
 *
 * archiveChannelViaZero must:
 *   - return null when Zero is unavailable (caller falls back to REST)
 *   - return { ok: true } when the server confirms
 *   - return { ok: false, error } when the server rejects
 *   - return null when the server reply times out (so caller can REST)
 */
describe("zero-writes — archiveChannelViaZero", () => {
  const origEnv = process.env.ANO_USE_ZERO;
  beforeEach(() => {
    setActiveZeroClient(null);
  });
  afterEach(() => {
    setActiveZeroClient(null);
    if (origEnv === undefined) delete process.env.ANO_USE_ZERO;
    else process.env.ANO_USE_ZERO = origEnv;
  });

  it("returns null when Zero is disabled", async () => {
    delete process.env.ANO_USE_ZERO;
    expect(await archiveChannelViaZero({ channel_id: "c1" })).toBeNull();
  });

  it("returns null when Zero is enabled but no active client", async () => {
    process.env.ANO_USE_ZERO = "1";
    expect(await archiveChannelViaZero({ channel_id: "c1" })).toBeNull();
  });

  it("returns { ok: true } when server confirms", async () => {
    process.env.ANO_USE_ZERO = "1";
    setActiveZeroClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zero: {
        mutate: {
          channels: {
            update: () => ({
              server: Promise.resolve({ type: "success" }),
            }),
          },
        },
      } as any,
      auth: {} as never,
      stats: () => ({
        replicaPath: "",
        replicaSizeBytes: null,
        connectionStatus: "connected",
      }),
      dispose: async () => {},
    });
    const r = await archiveChannelViaZero({ channel_id: "c1" });
    expect(r).toEqual({ ok: true });
  });

  it("returns { ok: false, error } when server rejects", async () => {
    process.env.ANO_USE_ZERO = "1";
    setActiveZeroClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zero: {
        mutate: {
          channels: {
            update: () => ({
              server: Promise.resolve({
                type: "error",
                error: new Error("Unauthorized: not admin or channel manager"),
              }),
            }),
          },
        },
      } as any,
      auth: {} as never,
      stats: () => ({
        replicaPath: "",
        replicaSizeBytes: null,
        connectionStatus: "connected",
      }),
      dispose: async () => {},
    });
    const r = await archiveChannelViaZero({ channel_id: "c1" });
    expect(r).toEqual({
      ok: false,
      error: "Unauthorized: not admin or channel manager",
    });
  });

  it("propagates a server-promise rejection as { ok: false } (no unhandled rejection)", async () => {
    process.env.ANO_USE_ZERO = "1";
    setActiveZeroClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zero: {
        mutate: {
          channels: {
            update: () => ({
              server: Promise.reject(new Error("zero connection dropped")),
            }),
          },
        },
      } as any,
      auth: {} as never,
      stats: () => ({
        replicaPath: "",
        replicaSizeBytes: null,
        connectionStatus: "connected",
      }),
      dispose: async () => {},
    });
    const seenUnhandled: unknown[] = [];
    const listener = (reason: unknown) => seenUnhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      const r = await archiveChannelViaZero({ channel_id: "c1" });
      expect(r).toEqual({
        ok: false,
        error: "zero connection dropped",
      });
      await new Promise((res) => setImmediate(res));
      await new Promise((res) => setImmediate(res));
      expect(seenUnhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });

  it("returns { ok: false } when constructing the mutation throws synchronously", async () => {
    process.env.ANO_USE_ZERO = "1";
    setActiveZeroClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zero: {
        mutate: {
          channels: {
            update: () => {
              throw new Error("zero not initialized");
            },
          },
        },
      } as any,
      auth: {} as never,
      stats: () => ({
        replicaPath: "",
        replicaSizeBytes: null,
        connectionStatus: "connecting",
      }),
      dispose: async () => {},
    });
    const r = await archiveChannelViaZero({ channel_id: "c1" });
    expect(r).toEqual({ ok: false, error: "zero not initialized" });
  });
});
