/**
 * Zero-backed read helpers for CLI commands.
 *
 * Each helper:
 *   1. Looks up the daemon's active Zero client (or null if Zero is off
 *      or hasn't bootstrapped yet).
 *   2. Runs the query against the local replica with a small timeout.
 *   3. Returns the data shaped exactly like the REST endpoint would —
 *      so callers can swap the API call for the Zero call without
 *      touching their output formatting.
 *   4. Returns `null` on miss (no Zero, timeout, query error). Caller
 *      falls back to REST.
 *
 * Why a timeout: the first read after `ano daemon start` may run while
 * Zero is still syncing the initial replica. We don't want CLI calls
 * to block on a 10-30s bootstrap — they fall back to REST and still
 * succeed, just one-time slow.
 *
 * The timeout is generous (1500ms) because subsequent reads are
 * SQLite-local and complete in microseconds; the timeout is only
 * load-bearing during the cold-start window.
 */
import {
  activeZeroOrNull,
  isTableDrifted,
  registerSchemaDrift,
} from "./active-client.js";
import type { Channel, User, Message } from "../core/api-client.js";
import { cliQueries } from "./queries.js";

// Cold call (first query after daemon start) goes through
// zero.run(..., { type: "complete" }) which waits for the server
// to materialize the named query. 5s gives the server-roundtrip
// + ZQL eval room without making the user wait too long; if it
// exceeds, fall back to REST.
const ZERO_READ_TIMEOUT_MS = 5_000;

/**
 * Schema-drift detector. Pass the table name + the expected column
 * names this helper reads off the row. If ANY expected column is
 * missing on the sample row, the table is registered as drifted
 * (subsequent reads on that table skip Zero), and this function
 * returns false to signal the caller should fall back to REST.
 *
 * Returns true (rows are usable) when:
 *   - The table has already been flagged drifted → caller already
 *     fell back; this function returns false to keep that going
 *   - No rows to sample → can't determine drift, returns true and
 *     hopes for the best (a column-missing bug surfaces on first
 *     non-empty result)
 *   - Sample row has every expected column → no drift, proceed
 *
 * Returns false (caller MUST fall back to REST) when:
 *   - Any expected column is missing on the sample row → drift
 *     registered; future reads on this table skip Zero
 *
 * This is the runtime mitigation for the silent-failure class where
 * the monorepo renames a column the CLI's vendored schema still
 * declares. Without it, reads silently return `undefined` for the
 * missing column (the `messages.body` → `messages.content` bug
 * caught manually in v2.23.0 development).
 */
function validateRowShape(
  table: string,
  rows: ReadonlyArray<Record<string, unknown>>,
  expectedColumns: ReadonlyArray<string>,
): boolean {
  if (isTableDrifted(table)) return false;
  if (rows.length === 0) return true;
  const sample = rows[0];
  for (const col of expectedColumns) {
    if (!(col in sample)) {
      registerSchemaDrift(
        table,
        `column '${col}' missing on returned row (vendored schema out of sync with server)`,
      );
      return false;
    }
  }
  return true;
}

/**
 * Wrap any Zero query promise with a timeout. Returns `null` if the
 * query exceeds the timeout (caller falls back to REST), or if the
 * query itself rejects (caller falls back too — never propagate Zero
 * errors out of the read helpers, since the whole point is that
 * Zero is best-effort).
 *
 * Attaches a `.catch()` to the underlying promise so it does NOT
 * become an unhandled rejection if it rejects AFTER the timeout has
 * already fired. Without this, a slow + eventually-failing Zero query
 * crashes the daemon under Node's strict unhandled-rejection mode.
 */
async function withTimeout<T>(p: Promise<T>): Promise<T | null> {
  // Swallow eventual rejection even if we've already returned null
  // from the race. Resolves to `null` on reject so the race outcome
  // is consistent ("timed out OR query errored → null").
  const safe = p.then(
    (v) => v as T | null,
    () => null as T | null,
  );
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ZERO_READ_TIMEOUT_MS);
  });
  try {
    return await Promise.race([safe, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * List channels for a workspace via Zero. Returns null if Zero is not
 * available — caller MUST fall back to REST.
 *
 * Mirrors `apiClient.listChannels({ workspace_id })`. The REST endpoint
 * filters by:
 *   - the caller's workspace memberships (server-side auth)
 *   - `is_archived = false`
 *   - `deleted_at IS NULL`
 *
 * Zero's row-level permissions already enforce membership, so we only
 * apply the archived + deleted filters here.
 */
export async function listChannelsViaZero(opts: {
  workspace_id?: string;
}): Promise<{ channels: Channel[] } | null> {
  const handle = activeZeroOrNull();
  if (!handle) return null;
  if (isTableDrifted("channels")) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const z = handle.zero as any;
  try {
    // Named query — `cliQueries.channels.activeByUser` has name
    // `channels.activeByUser` matching the monorepo's server-side
    // query. `zero.run(ref, { type: "complete" })` registers the
    // subscription AND waits for the server to materialize the
    // result. Without `{type: "complete"}`, run() returns whatever
    // is already in the local replica (empty on cold start) and
    // we'd uselessly fall through to REST.
    // Named query — server's `mustGetQuery(queries, name)` lookup
    // needs the name from `cliQueries.channels.activeByUser`. With
    // `{type: "complete"}`, `run()` waits for the server to
    // materialize the result into the local replica before
    // resolving (cold call ~few-100ms; warm call ~microseconds).
    const queryRef = cliQueries.channels.activeByUser();
    let rows = (await withTimeout(z.run(queryRef, { type: "complete" }))) as
      | Record<string, unknown>[]
      | null;
    // Client-side workspace filter (the server's
    // `channels.activeByUser` returns ALL workspaces the user
    // belongs to; we narrow here to match
    // `ano channels list --workspace <id>`).
    if (rows && opts.workspace_id) {
      rows = rows.filter((r) => r.workspace_id === opts.workspace_id);
    }
    if (rows === null) return null;
    // Empty result — fall through to REST. Zero's protocol means an
    // empty array here can be either: (a) workspace genuinely has 0
    // channels — rare, or (b) the server hasn't filled the local
    // replica for this query yet — common during cold start AND
    // currently the persistent failure mode on staging (server's
    // customQueryTransformer not streaming anonymous-legacy-query
    // table data). For both cases REST is correct; for (a) it's
    // ~100ms wasted on a rare command, for (b) the user actually
    // sees their data. The asymmetric cost makes the heuristic safe.
    if (Array.isArray(rows) && rows.length === 0) return null;
    if (
      !validateRowShape("channels", rows as Record<string, unknown>[], [
        "id",
        "name",
        "type",
        "is_private",
      ])
    ) {
      return null;
    }
    return {
      channels: (rows as unknown as ChannelRow[]).map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        topic: r.topic ?? undefined,
        is_private: r.is_private,
        workspace_id: r.workspace_id,
      })),
    };
  } catch {
    return null;
  }
}

/**
 * List workspace members (users) via Zero. Mirrors
 * `apiClient.listUsers({ workspace_id })`.
 */
export async function listUsersViaZero(opts: {
  workspace_id?: string;
}): Promise<{ users: User[] } | null> {
  const handle = activeZeroOrNull();
  if (!handle) return null;
  if (!opts.workspace_id) return null; // Zero requires a workspace scope
  if (isTableDrifted("workspace_members") || isTableDrifted("users")) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const z = handle.zero as any;
  try {
    // Named query `workspace_members.byWorkspace` matches the
    // monorepo's `queries.workspace_members.byWorkspace`. Server
    // returns active members of the requested workspace (already
    // filtered to removed_at IS NULL) with `.related("user")`.
    const queryRef = cliQueries.workspace_members.byWorkspace(
      opts.workspace_id,
    );
    const rows = await withTimeout(z.run(queryRef, { type: "complete" }));
    if (rows === null) return null;
    if (Array.isArray(rows) && rows.length === 0) return null;
    if (
      !validateRowShape(
        "workspace_members",
        rows as Record<string, unknown>[],
        ["id", "workspace_id", "user_id"],
      )
    ) {
      return null;
    }
    // The server's `workspace_members.byWorkspace` does NOT
    // `.related("user")` — joined user data only materializes
    // locally if the users table is independently subscribed (e.g.
    // because a `messages.byChannelComposite` subscription has
    // `.related("sender")` populating users for the active channel).
    // If we have member rows but no user joins, the replica doesn't
    // have enough data — fall back to REST rather than silently
    // returning an empty roster. Track once-per-daemon via the drift
    // registry so subsequent calls short-circuit fast.
    const rowsWithUser = (rows as WorkspaceMemberRow[]).filter((r) => r.user);
    if (rowsWithUser.length === 0) {
      registerSchemaDrift(
        "workspace_members",
        'byWorkspace returned rows without `.related("user")` — users table not populated in local replica',
      );
      return null;
    }
    if (
      !validateRowShape(
        "users",
        [rowsWithUser[0].user as unknown as Record<string, unknown>],
        ["id", "display_name", "is_deactivated"],
      )
    ) {
      return null;
    }
    const seen = new Set<string>();
    const users: User[] = [];
    for (const r of rows as WorkspaceMemberRow[]) {
      const u = r.user;
      if (!u || seen.has(u.id) || u.is_deactivated) continue;
      seen.add(u.id);
      users.push({
        id: u.id,
        display_name: u.display_name,
        email: u.email,
        avatar_url: u.avatar_url ?? undefined,
      });
    }
    return { users };
  } catch {
    return null;
  }
}

/**
 * Read recent messages from a channel via Zero. Mirrors
 * `apiClient.readMessages({ channel_id, limit })`.
 */
export async function readMessagesViaZero(opts: {
  channel_id: string;
  limit?: number;
}): Promise<{ messages: Message[] } | null> {
  const handle = activeZeroOrNull();
  if (!handle) return null;
  if (isTableDrifted("messages")) return null;

  const limit = opts.limit ?? 50;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const z = handle.zero as any;
  try {
    // Named query — server enforces `channelMemberGuard(sub)` so
    // only channels the user belongs to materialize. Cold call
    // ~50-200ms (server roundtrip + Postgres materialize); warm
    // call ~0ms from the local replica. Each channel ID is its
    // own subscription, so the first read of a new channel always
    // pays the cold cost.
    const queryRef = cliQueries.messages.byChannelComposite({
      channelId: opts.channel_id,
      limit,
    });
    const rows = await withTimeout(z.run(queryRef, { type: "complete" }));
    if (rows === null) return null;
    if (Array.isArray(rows) && rows.length === 0) return null;
    if (
      !validateRowShape("messages", rows as Record<string, unknown>[], [
        "id",
        "channel_id",
        "user_id",
        "content",
        "created_at",
      ])
    ) {
      return null;
    }
    // REST returns oldest → newest; we asked Zero for newest → reverse.
    const messages: Message[] = (rows as MessageRow[])
      .slice()
      .reverse()
      .map((r) => ({
        id: r.id,
        sender: {
          id: r.sender?.id ?? r.user_id,
          name: r.sender?.display_name ?? "unknown",
        },
        content: r.content,
        timestamp: r.created_at,
      }));
    return { messages };
  } catch {
    return null;
  }
}

/**
 * Search messages by query string via Zero. Mirrors
 * `apiClient.searchMessages({ query, workspace_id, limit })`.
 *
 * Local SQLite has no full-text index by default; we do a `LIKE` scan
 * with a low limit. Acceptable for an interactive CLI grep. If users
 * want a real FTS path, that's a follow-up (Zero supports
 * server-side queries that materialize on demand).
 */
export async function searchMessagesViaZero(opts: {
  query: string;
  workspace_id?: string;
  limit?: number;
}): Promise<{ messages: Message[] } | null> {
  const handle = activeZeroOrNull();
  if (!handle) return null;
  if (isTableDrifted("messages")) return null;
  // Empty needle would match every message via `.includes("")`. Treat
  // an empty/whitespace-only query as "no search" and fall back to
  // REST — caller decides whether that's a usage error or a no-op.
  if (opts.query.trim() === "") return null;

  const limit = opts.limit ?? 25;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const z = handle.zero as any;
  try {
    // Strategy: subscribe to `messages.recentByUserMemberships`
    // (the monorepo's cross-channel cap-10K query, also used by
    // the desktop CommandPalette). Once it fills the replica,
    // filter client-side by content LIKE. First call pays the
    // ~10K-row materialize (slow once); subsequent searches reuse
    // the warm replica (microseconds local LIKE scan). No server
    // FTS query exists today — this is the pragmatic substitute.
    // Subscribe to users IN PARALLEL with the message pull. Server's
    // `recentByUserMemberships` doesn't `.related("sender")`, so we
    // need users in the local replica to resolve display names —
    // otherwise every match prints "unknown". `users.byWorkspacesOfUser`
    // is the matching server-side query; once it lands, subsequent
    // searches stay warm.
    const messagesQueryRef = cliQueries.messages.recentByUserMemberships(10000);
    const usersQueryRef = cliQueries.users.byWorkspacesOfUser();
    const [allRows, userRows] = (await Promise.all([
      withTimeout(z.run(messagesQueryRef, { type: "complete" })),
      withTimeout(z.run(usersQueryRef, { type: "complete" })),
    ])) as [Record<string, unknown>[] | null, Record<string, unknown>[] | null];
    if (allRows === null) return null;
    if (Array.isArray(allRows) && allRows.length === 0) return null;

    // Build a userId → display_name lookup. userRows may be null (the
    // users subscription hit the timeout); fall back to "unknown" then.
    const userById = new Map<string, string>();
    if (Array.isArray(userRows)) {
      for (const u of userRows) {
        const id = u.id;
        const name = u.display_name;
        if (typeof id === "string" && typeof name === "string") {
          userById.set(id, name);
        }
      }
    }

    // Client-side filter: content contains query (case-insensitive).
    // Workspace scope: the named query already filters to the user's
    // memberships server-side; for an additional `--workspace`
    // narrowing, we'd need a `.related("channel")` join the named
    // query doesn't provide. Acceptable tradeoff: returns matches
    // across all the user's workspaces, matching how REST's search
    // behaves under the hood for this user.
    const needle = opts.query.toLowerCase();
    const filtered = allRows.filter((r) => {
      const content = r.content;
      return typeof content === "string"
        ? content.toLowerCase().includes(needle)
        : false;
    });
    const rows = filtered.slice(0, limit);
    if (Array.isArray(rows) && rows.length === 0) return null;
    if (
      !validateRowShape("messages", rows as Record<string, unknown>[], [
        "id",
        "channel_id",
        "user_id",
        "content",
        "created_at",
      ])
    ) {
      return null;
    }
    const messages: Message[] = (rows as unknown as MessageRow[]).map((r) => ({
      id: r.id,
      sender: {
        id: r.sender?.id ?? r.user_id,
        name: r.sender?.display_name ?? userById.get(r.user_id) ?? "unknown",
      },
      content: r.content,
      timestamp: r.created_at,
      channel: r.channel?.name,
    }));
    return { messages };
  } catch {
    return null;
  }
}

// ── row shapes (narrow projections of CliSchema tables) ─────────────

interface ChannelRow {
  id: string;
  name: string;
  type: string;
  topic: string | null | undefined;
  is_private: boolean;
}

interface MessageRow {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  created_at: number;
  sender?: {
    id: string;
    display_name: string;
    email: string;
    avatar_url?: string | null;
  };
  channel?: { id: string; name: string; workspace_id?: string | null };
}

interface WorkspaceMemberRow {
  id: string;
  workspace_id: string;
  user_id: string;
  removed_at: number | null | undefined;
  user?: {
    id: string;
    display_name: string;
    email: string;
    avatar_url?: string | null;
    is_deactivated: boolean;
  };
}
