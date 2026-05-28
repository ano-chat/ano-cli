/**
 * Zero-backed write helpers for CLI commands.
 *
 * Pattern:
 *   1. Look up the daemon's active Zero client (or null if Zero is
 *      off, not bootstrapped, or the requested mutator isn't
 *      vendored on the CLI side).
 *   2. Fire the mutator — applies optimistically to the local
 *      replica, returns a handle exposing `.server` for the
 *      authoritative reply.
 *   3. Await `.server` so the CLI command surfaces server-side
 *      rejections synchronously (otherwise the user sees "success"
 *      then never finds out their write was rejected). Bounded by
 *      a generous timeout so a flaky WebSocket doesn't hang the
 *      command indefinitely.
 *   4. Return success or throw — caller handles output formatting.
 *
 * Returns `null` instead of throwing when Zero is unavailable —
 * caller falls back to REST. This matches the shape of `reads.ts`.
 *
 * Timeout: 5s. Larger than the read timeout because writes do
 * server-side work (DB transactions, fan-out triggers); 1.5s would
 * over-aggressively fall back to REST during normal latency
 * spikes.
 */
import { randomUUID } from "node:crypto";
import { activeZeroOrNull } from "./active-client.js";
import { cliMutators } from "./mutators.js";

const ZERO_WRITE_TIMEOUT_MS = 5_000;

/**
 * Wait for the server reply to a Zero mutation, with a timeout.
 *
 * Zero exposes `mutation.server` — a promise that resolves to
 * `{ type: 'success' }` or `{ type: 'error', error }` when the
 * server has either confirmed or rejected the write. The CLI
 * command treats any 'error' as a hard failure (throws); on
 * timeout it returns null so the caller can fall back to REST.
 */
async function awaitServerWithTimeout(mutation: {
  server: Promise<unknown>;
}): Promise<{ ok: true } | { ok: false; error: string } | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ZERO_WRITE_TIMEOUT_MS);
  });
  // Wrap the server promise so a rejection doesn't become an
  // unhandled rejection if we lose the race.
  const safe = mutation.server.then(
    (v) => v,
    (err) => ({ type: "error", error: err }),
  );
  try {
    const result = await Promise.race([safe, timeout]);
    if (result === null) return null; // timeout
    // Discriminated union: Zero returns { type: 'success' } or
    // { type: 'error', error: ... } — defensively duck-type.
    const res = result as { type?: string; error?: unknown };
    if (res.type === "error") {
      const msg =
        res.error instanceof Error
          ? res.error.message
          : typeof res.error === "string"
            ? res.error
            : JSON.stringify(res.error);
      return { ok: false, error: msg };
    }
    return { ok: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Archive a channel via Zero. Returns:
 *   - `{ ok: true }` on success — the daemon's local replica has the
 *     channel flipped to `is_archived: true` AND the server has
 *     confirmed the write.
 *   - `{ ok: false, error }` on server rejection (auth failure,
 *     missing channel, space-type rejection).
 *   - `null` on miss — Zero isn't available; caller falls back to
 *     REST.
 *
 * The server-side authoritative mutator
 * (`channelsMutators.update` in the monorepo) enforces:
 *   - admin+ OR channel manager
 *   - rejects type='space' (must use clientSpacesMutators.update)
 *   - DM creator rule for workspace-less channels
 */
export async function archiveChannelViaZero(opts: {
  channel_id: string;
}): Promise<{ ok: true } | { ok: false; error: string } | null> {
  const handle = activeZeroOrNull();
  if (!handle) return null;
  try {
    // Pass the mutator INVOCATION to zero.mutate(...) — per
    // `.claude/rules/mutators.md`, calling `zero.mutate.X.method()`
    // directly bypasses the registry and the named-mutator wire
    // protocol (the bug surfaces as "Cannot read properties of
    // undefined (reading 'method')" because the `.mutate` proxy is
    // callable, not a nested object).
    //
    // Cast: Zero's heavily-generic Transaction<TSchema> can't unify
    // between the third type parameter on `ZeroWithCliMutators` (any)
    // and the inferred shape of `cliMutators.X.method(...)`. Runtime
    // shape is correct; same escape hatch desktop uses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const zMutate = handle.zero.mutate as unknown as (m: any) => any;
    const mutation = zMutate(
      cliMutators.channels.update({
        id: opts.channel_id,
        is_archived: true,
      }),
    );
    return await awaitServerWithTimeout(mutation);
  } catch (err) {
    // Synchronous throw from constructing the mutation (e.g. Zero
    // hasn't fully initialized yet). Treat as miss; caller falls
    // back to REST.
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Remove a user from a channel via Zero. Mirrors
 * `apiClient.channelMemberRemove({channel_id, user_id})`.
 *
 * Two-step: (1) look up the `channel_members` row id via the local
 * Zero replica, (2) call the soft-delete mutator. Both steps fail
 * gracefully — caller falls back to REST.
 *
 * Note: this REQUIRES the channel_members row to exist in the
 * local replica. If it doesn't (e.g. fresh daemon hasn't synced
 * far enough), return null and let REST handle it. We don't fabricate
 * an id — the server would reject a guess.
 */
export async function removeChannelMemberViaZero(opts: {
  channel_id: string;
  user_id: string;
}): Promise<{ ok: true } | { ok: false; error: string } | null> {
  const handle = activeZeroOrNull();
  if (!handle) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const z = handle.zero as any;
    const rows = await z.query.channel_members
      .where("channel_id", "=", opts.channel_id)
      .where("user_id", "=", opts.user_id)
      .where("removed_at", "IS", null)
      .run();
    if (!Array.isArray(rows) || rows.length === 0) {
      // Row not in local replica — REST knows how to resolve via the
      // composite (channel_id, user_id) key server-side.
      return null;
    }
    const id = rows[0].id as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const zMutate = handle.zero.mutate as unknown as (m: any) => any;
    const mutation = zMutate(cliMutators.channel_members.delete({ id }));
    return await awaitServerWithTimeout(mutation);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Send a plain-text message to a channel via Zero.
 *
 * Scope: TEXT-ONLY, no attachments, no threading, no @mentions, no
 * channel_name resolution (must be a channel id). All other paths
 * fall back to REST — caller passes null on those branches.
 *
 * Returns { id, channel_id } on success so the caller can include
 * the new message id in its output banner (REST returns the same
 * shape, so the caller doesn't need a special branch).
 */
export async function sendTextMessageViaZero(opts: {
  channel_id: string;
  content: string;
}): Promise<
  | { ok: true; id: string; channel_id: string }
  | { ok: false; error: string }
  | null
> {
  const handle = activeZeroOrNull();
  if (!handle) return null;
  try {
    const id = randomUUID();
    const now = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const zMutate = handle.zero.mutate as unknown as (m: any) => any;
    const mutation = zMutate(
      cliMutators.messages.insert({
        id,
        channel_id: opts.channel_id,
        user_id: handle.userId,
        content: opts.content,
        kind: "text",
        is_edited: false,
        created_at: now,
        updated_at: now,
      }),
    );
    const res = await awaitServerWithTimeout(mutation);
    if (res === null) return null;
    if (res.ok) {
      return { ok: true, id, channel_id: opts.channel_id };
    }
    return res;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
