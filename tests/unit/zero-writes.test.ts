import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  setActiveZeroClient,
  _setLastStatusForTests,
  _resetDriftedTablesForTests,
} from "../../src/zero/active-client.js";
import {
  archiveChannelViaZero,
  removeChannelMemberViaZero,
  sendTextMessageViaZero,
} from "../../src/zero/writes.js";

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
  const origEnv = process.env.ANO_DISABLE_ZERO;
  beforeEach(() => {
    setActiveZeroClient(null);
    _resetDriftedTablesForTests();
    // Force Zero's connection guard to "connected" so write helpers
    // proceed; tests that want the disconnected branch set it
    // explicitly. (Mirrors the zero-reads.test.ts fixture.)
    _setLastStatusForTests("connected");
    delete process.env.ANO_DISABLE_ZERO;
  });
  afterEach(() => {
    setActiveZeroClient(null);
    _resetDriftedTablesForTests();
    _setLastStatusForTests("init");
    if (origEnv === undefined) delete process.env.ANO_DISABLE_ZERO;
    else process.env.ANO_DISABLE_ZERO = origEnv;
  });

  it("returns null when Zero is disabled", async () => {
    process.env.ANO_DISABLE_ZERO = "1";
    expect(await archiveChannelViaZero({ channel_id: "c1" })).toBeNull();
  });

  it("returns null when Zero is enabled but no active client", async () => {
    // Zero default-on; beforeEach already unset ANO_DISABLE_ZERO.
    expect(await archiveChannelViaZero({ channel_id: "c1" })).toBeNull();
  });

  it("returns { ok: true } when server confirms", async () => {
    // Zero default-on; beforeEach already unset ANO_DISABLE_ZERO.
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
    // Zero default-on; beforeEach already unset ANO_DISABLE_ZERO.
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
    // Zero default-on; beforeEach already unset ANO_DISABLE_ZERO.
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
    // Zero default-on; beforeEach already unset ANO_DISABLE_ZERO.
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

describe("zero-writes — removeChannelMemberViaZero", () => {
  const origEnv = process.env.ANO_DISABLE_ZERO;
  beforeEach(() => {
    setActiveZeroClient(null);
    _resetDriftedTablesForTests();
    // Force Zero's connection guard to "connected" so write helpers
    // proceed; tests that want the disconnected branch set it
    // explicitly. (Mirrors the zero-reads.test.ts fixture.)
    _setLastStatusForTests("connected");
    delete process.env.ANO_DISABLE_ZERO;
  });
  afterEach(() => {
    setActiveZeroClient(null);
    _resetDriftedTablesForTests();
    _setLastStatusForTests("init");
    if (origEnv === undefined) delete process.env.ANO_DISABLE_ZERO;
    else process.env.ANO_DISABLE_ZERO = origEnv;
  });

  it("returns null when Zero is off", async () => {
    process.env.ANO_DISABLE_ZERO = "1";
    expect(
      await removeChannelMemberViaZero({ channel_id: "c1", user_id: "u1" }),
    ).toBeNull();
  });

  it("returns null when the channel_members row isn't in the local replica", async () => {
    // Zero default-on; beforeEach already unset ANO_DISABLE_ZERO.
    setActiveZeroClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zero: {
        query: {
          channel_members: makeQueryChain([]),
        },
      } as any,
      userId: "u-actor",
      auth: {} as never,
      stats: () => ({
        replicaPath: "",
        replicaSizeBytes: null,
        connectionStatus: "connected",
      }),
      dispose: async () => {},
    });
    const r = await removeChannelMemberViaZero({
      channel_id: "c1",
      user_id: "u1",
    });
    expect(r).toBeNull();
  });

  it("returns { ok: true } when row found AND server confirms", async () => {
    // Zero default-on; beforeEach already unset ANO_DISABLE_ZERO.
    setActiveZeroClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zero: {
        query: {
          channel_members: makeQueryChain([
            { id: "cm-123", channel_id: "c1", user_id: "u1" },
          ]),
        },
        mutate: {
          channel_members: {
            delete: (args: { id: string }) => {
              expect(args.id).toBe("cm-123");
              return { server: Promise.resolve({ type: "success" }) };
            },
          },
        },
      } as any,
      userId: "u-actor",
      auth: {} as never,
      stats: () => ({
        replicaPath: "",
        replicaSizeBytes: null,
        connectionStatus: "connected",
      }),
      dispose: async () => {},
    });
    const r = await removeChannelMemberViaZero({
      channel_id: "c1",
      user_id: "u1",
    });
    expect(r).toEqual({ ok: true });
  });
});

describe("zero-writes — sendTextMessageViaZero", () => {
  const origEnv = process.env.ANO_DISABLE_ZERO;
  beforeEach(() => {
    setActiveZeroClient(null);
    _resetDriftedTablesForTests();
    // Force Zero's connection guard to "connected" so write helpers
    // proceed; tests that want the disconnected branch set it
    // explicitly. (Mirrors the zero-reads.test.ts fixture.)
    _setLastStatusForTests("connected");
    delete process.env.ANO_DISABLE_ZERO;
  });
  afterEach(() => {
    setActiveZeroClient(null);
    _resetDriftedTablesForTests();
    _setLastStatusForTests("init");
    if (origEnv === undefined) delete process.env.ANO_DISABLE_ZERO;
    else process.env.ANO_DISABLE_ZERO = origEnv;
  });

  it("returns null when Zero is off", async () => {
    process.env.ANO_DISABLE_ZERO = "1";
    expect(
      await sendTextMessageViaZero({ channel_id: "c1", content: "hi" }),
    ).toBeNull();
  });

  it("sends with caller userId, returns { ok, id, channel_id } on success", async () => {
    // Zero default-on; beforeEach already unset ANO_DISABLE_ZERO.
    let insertedArgs: Record<string, unknown> | null = null;
    setActiveZeroClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zero: {
        mutate: {
          messages: {
            insert: (args: Record<string, unknown>) => {
              insertedArgs = args;
              return { server: Promise.resolve({ type: "success" }) };
            },
          },
        },
      } as any,
      userId: "u-actor",
      auth: {} as never,
      stats: () => ({
        replicaPath: "",
        replicaSizeBytes: null,
        connectionStatus: "connected",
      }),
      dispose: async () => {},
    });
    const r = await sendTextMessageViaZero({
      channel_id: "c1",
      content: "hello",
    });
    expect(r).not.toBeNull();
    expect(r).toMatchObject({ ok: true, channel_id: "c1" });
    if (r && r.ok) expect(typeof r.id).toBe("string");
    expect(insertedArgs).toMatchObject({
      channel_id: "c1",
      user_id: "u-actor",
      content: "hello",
      kind: "text",
      is_edited: false,
    });
  });

  it("surfaces server errors", async () => {
    // Zero default-on; beforeEach already unset ANO_DISABLE_ZERO.
    setActiveZeroClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zero: {
        mutate: {
          messages: {
            insert: () => ({
              server: Promise.resolve({
                type: "error",
                error: "Unauthorized: not a channel member",
              }),
            }),
          },
        },
      } as any,
      userId: "u-actor",
      auth: {} as never,
      stats: () => ({
        replicaPath: "",
        replicaSizeBytes: null,
        connectionStatus: "connected",
      }),
      dispose: async () => {},
    });
    const r = await sendTextMessageViaZero({
      channel_id: "c1",
      content: "hello",
    });
    expect(r).toEqual({
      ok: false,
      error: "Unauthorized: not a channel member",
    });
  });
});

/**
 * Build a chainable Zero query stub that resolves `.run()` to the
 * given rows. Records `.where(...)` calls but doesn't validate args
 * — narrow assertions live in individual tests.
 */
function makeQueryChain(rows: unknown[]): unknown {
  const chain: Record<string, unknown> = {};
  for (const m of ["where", "orderBy", "limit", "related"] as const) {
    chain[m] = () => chain;
  }
  chain.run = async () => rows;
  return chain;
}
