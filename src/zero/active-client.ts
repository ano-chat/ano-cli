/**
 * Module-scoped registry for the daemon's active Zero client.
 *
 * The daemon constructs ONE Zero client at startup (when
 * unless `ANO_DISABLE_ZERO=1`), stashes it here, and dispatched commands look
 * it up on demand. If null, commands fall back to the REST path.
 *
 * Module-level state is the right shape because:
 *   - The daemon process owns exactly one Zero client across its
 *     lifetime — there's no per-dispatch-thread isolation needed.
 *   - Commands run inside the daemon's dispatch (per `server.ts`'s
 *     dispatch function), so they share module-level state with the
 *     daemon itself.
 *   - When the daemon shuts down, `dispose()` clears this and awaits
 *     `zero.close()`.
 *
 * Reading: any command calls `getActiveZeroClient()` and either
 * uses the returned handle or falls through to REST.
 */
import type { ZeroClientHandle } from "./client.js";

let active: ZeroClientHandle | null = null;

export function setActiveZeroClient(handle: ZeroClientHandle | null): void {
  active = handle;
}

export function getActiveZeroClient(): ZeroClientHandle | null {
  return active;
}

/**
 * Convenience: only returns the handle when Zero is BOTH constructed
 * AND the user hasn't opted out. Commands use this as the deciding
 * predicate for "Zero path or REST path?".
 *
 * Default ON; opt out with `ANO_DISABLE_ZERO=1`. Mirrors
 * `isZeroEnabled()` in client.ts (same env var) so a user who flips
 * the gate sees consistent behavior across both bootstrap-time and
 * read-time checks.
 */
export function activeZeroOrNull(): ZeroClientHandle | null {
  const v = process.env.ANO_DISABLE_ZERO;
  if (v === "1" || v === "true") return null;
  return active;
}
