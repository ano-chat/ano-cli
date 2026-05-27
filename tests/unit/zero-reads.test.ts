import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  setActiveZeroClient,
  getActiveZeroClient,
} from "../../src/zero/active-client.js";
import {
  listChannelsViaZero,
  listUsersViaZero,
  readMessagesViaZero,
  searchMessagesViaZero,
} from "../../src/zero/reads.js";

/**
 * Tests for the Zero-read fallback semantics.
 *
 * The most load-bearing property: when Zero is unavailable (disabled,
 * not bootstrapped, or query throws), the helper MUST return null so
 * the caller falls back to REST. These tests pin that down without
 * spinning up an actual Zero replica.
 */
describe("zero-reads — fallback semantics", () => {
  const origEnv = process.env.ANO_DISABLE_ZERO;
  beforeEach(() => {
    setActiveZeroClient(null);
    // Each test resets the env to default (Zero on); tests that
    // want it off opt in via `process.env.ANO_DISABLE_ZERO = "1"`.
    delete process.env.ANO_DISABLE_ZERO;
  });
  afterEach(() => {
    setActiveZeroClient(null);
    if (origEnv === undefined) delete process.env.ANO_DISABLE_ZERO;
    else process.env.ANO_DISABLE_ZERO = origEnv;
  });

  it("returns null when Zero is disabled via ANO_DISABLE_ZERO=1", async () => {
    process.env.ANO_DISABLE_ZERO = "1";
    expect(await listChannelsViaZero({})).toBeNull();
    expect(await listUsersViaZero({ workspace_id: "w" })).toBeNull();
    expect(await readMessagesViaZero({ channel_id: "c" })).toBeNull();
    expect(await searchMessagesViaZero({ query: "x" })).toBeNull();
  });

  it("returns null when no active client is registered (Zero on but not bootstrapped)", async () => {
    // default (Zero on) — beforeEach() already unset ANO_DISABLE_ZERO.
    expect(getActiveZeroClient()).toBeNull();
    expect(await listChannelsViaZero({})).toBeNull();
  });

  it("returns null when the underlying query throws", async () => {
    // Zero default-on; beforeEach already unset ANO_DISABLE_ZERO.
    setActiveZeroClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zero: {
        query: new Proxy(
          {},
          {
            get() {
              throw new Error("boom");
            },
          },
        ),
      } as any,
      auth: {} as never,
      stats: () => ({
        replicaPath: "",
        replicaSizeBytes: null,
        connectionStatus: "test",
      }),
      dispose: async () => {},
    });
    expect(await listChannelsViaZero({})).toBeNull();
    expect(await readMessagesViaZero({ channel_id: "c" })).toBeNull();
  });

  it("returns null on listUsersViaZero without workspace_id (Zero requires scope)", async () => {
    // Zero default-on; beforeEach already unset ANO_DISABLE_ZERO.
    // Even with an active client, listUsers needs a workspace_id.
    setActiveZeroClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zero: { query: {} } as any,
      auth: {} as never,
      stats: () => ({
        replicaPath: "",
        replicaSizeBytes: null,
        connectionStatus: "test",
      }),
      dispose: async () => {},
    });
    expect(await listUsersViaZero({})).toBeNull();
  });

  it("returns null when the query promise rejects asynchronously (no unhandled rejection)", async () => {
    // Zero default-on; beforeEach already unset ANO_DISABLE_ZERO.
    // Build a chain whose `.run()` rejects after a microtask.
    const rejectingChain = makeChainStub([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rejectingChain as any).run = async () => {
      throw new Error("zero query exploded");
    };
    setActiveZeroClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zero: { query: { channels: rejectingChain } } as any,
      auth: {} as never,
      stats: () => ({
        replicaPath: "",
        replicaSizeBytes: null,
        connectionStatus: "test",
      }),
      dispose: async () => {},
    });

    // Track unhandled rejections during this test.
    const seenUnhandled: unknown[] = [];
    const listener = (reason: unknown) => seenUnhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      const result = await listChannelsViaZero({});
      expect(result).toBeNull();
      // Give the microtask queue a chance to surface unhandled rejections.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(seenUnhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });

  it("returns rows shaped like REST when query resolves", async () => {
    // Zero default-on; beforeEach already unset ANO_DISABLE_ZERO.
    // Mock a Zero query chain that returns three channels.
    const fakeQuery = makeChainStub([
      {
        id: "c1",
        name: "general",
        type: "channel",
        topic: null,
        is_private: false,
      },
      {
        id: "c2",
        name: "random",
        type: "channel",
        topic: "off-topic",
        is_private: false,
      },
    ]);
    setActiveZeroClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zero: { query: { channels: fakeQuery } } as any,
      auth: {} as never,
      stats: () => ({
        replicaPath: "",
        replicaSizeBytes: null,
        connectionStatus: "connected",
      }),
      dispose: async () => {},
    });
    const result = await listChannelsViaZero({ workspace_id: "w1" });
    expect(result).not.toBeNull();
    expect(result!.channels).toHaveLength(2);
    expect(result!.channels[0]).toEqual({
      id: "c1",
      name: "general",
      type: "channel",
      topic: undefined,
      is_private: false,
    });
    expect(result!.channels[1].topic).toBe("off-topic");
  });
});

/**
 * Build a chainable Query stub that records `.where(...)` /
 * `.orderBy(...)` / `.related(...)` / `.limit(...)` calls and resolves
 * `.run()` to the given rows. Lets us assert "the helper produces the
 * right output" without depending on a real Zero replica.
 */
function makeChainStub(rows: unknown[]): unknown {
  const chain: Record<string, unknown> = {};
  const methods = [
    "where",
    "whereExists",
    "orderBy",
    "limit",
    "related",
  ] as const;
  for (const m of methods) {
    chain[m] = () => chain;
  }
  chain.run = async () => rows;
  return chain;
}
