/**
 * Module-scoped registry for the daemon's active Zero client.
 *
 * The daemon constructs ONE Zero client at startup (unless
 * `ANO_DISABLE_ZERO=1`), stashes it here, and dispatched commands
 * look it up on demand. If null, commands fall back to the REST path.
 *
 * Connection-state tracking (added v2.23.0): the daemon registers
 * each transition on `zero.connection.state` here via
 * `setLastConnectionStatus()`. The `activeZeroOrNull()` guard checks
 * this status — if Zero isn't currently "connected", reads fall
 * back to REST rather than returning stale data from a desynced
 * replica.
 *
 * Schema-drift tracking (added v2.23.0): the read helpers report
 * tables that returned rows missing expected columns. Once a table
 * is flagged, `isTableDrifted()` returns true and reads skip Zero
 * for that table for the rest of the daemon's lifetime. Daemon
 * status surfaces the registry.
 */
import type { ZeroClientHandle } from "./client.js";

let active: ZeroClientHandle | null = null;

/**
 * Last connection state observed from `zero.connection.state`. Zero's
 * states (per the `ConnectionState` discriminated union):
 *   "init" | "disconnected" | "connecting" | "connected" |
 *   "needs-auth" | "error" | "closed"
 *
 * Only "connected" means the local replica is in sync with the
 * server and queries return fresh data. The other states either
 * have no replica yet or have a divergent one.
 */
let lastStatus: string = "init";

/**
 * Tables that returned rows missing expected columns. Schema drift
 * is per-table (one table's column rename doesn't poison the others),
 * so the gate is also per-table. Once flagged, the table stays
 * drifted for the daemon's lifetime — restart the daemon to retry
 * after fixing the vendored schema.
 */
const driftedTables = new Map<string, string>();

export function setActiveZeroClient(handle: ZeroClientHandle | null): void {
  active = handle;
  if (handle === null) {
    lastStatus = "closed";
    driftedTables.clear();
  }
}

export function getActiveZeroClient(): ZeroClientHandle | null {
  return active;
}

export function setLastConnectionStatus(status: string): void {
  lastStatus = status;
}

export function getLastConnectionStatus(): string {
  return lastStatus;
}

/**
 * Mark a table as schema-drifted. Reads on this table skip Zero for
 * the remainder of the daemon's lifetime.
 *
 * `reason` is short and human-readable, e.g. "column 'content' missing"
 * — surfaces via `ano daemon status`.
 */
export function registerSchemaDrift(table: string, reason: string): void {
  if (!driftedTables.has(table)) {
    driftedTables.set(table, reason);
    // Log to stderr — the daemon's dispatch captures stderr and sends
    // it back to the client, so the user sees the warning on the call
    // that detected the drift. Also useful for daemon-log forensics
    // if we ever wire one up.
    process.stderr.write(
      `[ano:zero] schema drift on '${table}': ${reason}. Falling back to REST for this table until daemon restart.\n`,
    );
  }
}

export function isTableDrifted(table: string): boolean {
  return driftedTables.has(table);
}

export function getDriftedTables(): Array<{ table: string; reason: string }> {
  return [...driftedTables.entries()].map(([table, reason]) => ({
    table,
    reason,
  }));
}

/**
 * Convenience: only returns the handle when ALL of these are true:
 *   - Zero is constructed (bootstrap succeeded)
 *   - User hasn't opted out (`ANO_DISABLE_ZERO=1`)
 *   - WebSocket is currently CONNECTED (not disconnected/error/etc.)
 *
 * Commands use this as the deciding predicate for "Zero path or
 * REST path?". The connected-state check is the websocket-drop
 * mitigation: if Zero is in any state other than "connected", we
 * don't trust the local replica's freshness and fall back to REST.
 *
 * Default ON; opt out with `ANO_DISABLE_ZERO=1`. Mirrors
 * `isZeroEnabled()` in client.ts (same env var) so a user who flips
 * the gate sees consistent behavior across both bootstrap-time and
 * read-time checks.
 */
export function activeZeroOrNull(): ZeroClientHandle | null {
  const v = process.env.ANO_DISABLE_ZERO;
  if (v === "1" || v === "true") return null;
  if (!active) return null;
  // Websocket-drop guard: only "connected" means the replica is in
  // sync. Any other state — disconnected, connecting, error,
  // needs-auth, closed — and we'd risk serving stale data.
  if (lastStatus !== "connected") return null;
  return active;
}

/**
 * Test-only: reset the drift registry between tests.
 */
export function _resetDriftedTablesForTests(): void {
  driftedTables.clear();
}

/**
 * Test-only: force the last status. Production callers use
 * `setLastConnectionStatus`, which is hooked up to Zero's
 * `connection.state.subscribe`.
 */
export function _setLastStatusForTests(status: string): void {
  lastStatus = status;
}
