/**
 * In-process response cache for read-only `/mcp/*` POST endpoints.
 *
 * The CLI's API surface uses POST for all calls, including pure reads
 * like `/mcp/list_channels` and `/mcp/list_users`. When the daemon
 * serves many sequential CLI invocations, the same read often
 * repeats inside a few seconds — agents listing channels to decide
 * which one to message, then listing users to mention, then listing
 * channels again. Each call is a ~30 ms round trip even with
 * keepalive. With a small TTL'd cache scoped to the daemon process,
 * repeats become sub-millisecond.
 *
 * Design points (kept deliberately minimal):
 *
 *   • **Allowlist of read paths only** — anything not in the list
 *     bypasses the cache entirely. No accidental caching of mutations.
 *   • **Short TTL (5 s)** — small enough that stale data is rarely
 *     a UX concern. Channels lists don't change THAT fast.
 *   • **Write invalidation** — any call to a path NOT in the read
 *     allowlist on the same origin clears the entire cache for that
 *     origin. Simpler than per-entity tagging; the cost is occasional
 *     extra re-fetches after a mutation, which is fine because the
 *     post-mutation read needs to be fresh anyway.
 *   • **Per-auth scoping** — cache key includes a hash of the auth
 *     header so two profiles in the same daemon process can't see
 *     each other's data.
 *   • **No persistence** — daemon process death = cold cache. By
 *     design; persistence would add complexity for tiny additional win.
 *
 * Eviction: there's no LRU here. Entries expire on TTL; until then
 * they sit in the Map. Typical agent sessions touch maybe 10-20
 * distinct keys, so the Map stays small. If pathological workloads
 * appear we'll add LRU later.
 */
import { createHash } from "node:crypto";

/**
 * Endpoints that may be served from cache. All MUST be pure reads
 * (server-side idempotent, no observable side effects). Adding a
 * write path here is a correctness bug — review carefully.
 */
const READ_ALLOWLIST = new Set<string>([
  "/list_workspaces",
  "/list_channels",
  "/list_users",
  "/list_tables",
  "/get_table",
  // Note: NOT /read_messages or /search_messages — those return live
  // chat data where 5s staleness is user-visible and annoying. Add
  // them later behind an explicit flag if benchmarks show benefit.
  // Note: NOT /automation_* — list endpoints are read but mutate
  // often enough that the post-mutation read should always be fresh.
]);

interface Entry {
  status: number;
  headers: Record<string, string>;
  body: string;
  expiresAt: number;
}

interface OriginCache {
  entries: Map<string, Entry>;
}

const TTL_MS = 5_000;

/** Map of origin (scheme + host + port) → cache for that origin. */
const cacheByOrigin = new Map<string, OriginCache>();

/**
 * Cumulative counters for `ano daemon status` and ANO_DEBUG_CACHE
 * telemetry. Process-local — reset when the daemon restarts.
 */
interface CacheStats {
  hits: number;
  misses: number;
  invalidations: number;
}
const stats: CacheStats = { hits: 0, misses: 0, invalidations: 0 };

export function cacheStats(): CacheStats & {
  origins: number;
  entries: number;
} {
  let entries = 0;
  for (const oc of cacheByOrigin.values()) entries += oc.entries.size;
  return {
    hits: stats.hits,
    misses: stats.misses,
    invalidations: stats.invalidations,
    origins: cacheByOrigin.size,
    entries,
  };
}

export function _resetCacheStatsForTests(): void {
  stats.hits = 0;
  stats.misses = 0;
  stats.invalidations = 0;
}

/**
 * Check the cache for a hit. Returns undefined on miss or expired
 * entry. Caller is responsible for synthesizing a Response from the
 * cached payload (we don't return a Response directly so the cache
 * doesn't have to materialize one on miss).
 */
export function cacheGet(
  url: string,
  authHeader: string | undefined,
  bodyJson: string,
): Entry | undefined {
  const parsed = parseCacheable(url);
  if (!parsed) return undefined;
  const { origin, path } = parsed;
  if (!READ_ALLOWLIST.has(path)) return undefined;
  const oc = cacheByOrigin.get(origin);
  if (!oc) {
    stats.misses++;
    return undefined;
  }
  const key = makeKey(path, authHeader, bodyJson);
  const entry = oc.entries.get(key);
  if (!entry) {
    stats.misses++;
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    oc.entries.delete(key);
    stats.misses++;
    return undefined;
  }
  stats.hits++;
  return entry;
}

/**
 * Store a successful response. Only entries with `status === 200`
 * and an allowlisted path are stored — errors and non-reads pass
 * through untouched.
 */
export function cacheSet(
  url: string,
  authHeader: string | undefined,
  bodyJson: string,
  resp: { status: number; headers: Record<string, string>; body: string },
): void {
  if (resp.status !== 200) return;
  const parsed = parseCacheable(url);
  if (!parsed) return;
  const { origin, path } = parsed;
  if (!READ_ALLOWLIST.has(path)) return;
  let oc = cacheByOrigin.get(origin);
  if (!oc) {
    oc = { entries: new Map() };
    cacheByOrigin.set(origin, oc);
  }
  const key = makeKey(path, authHeader, bodyJson);
  oc.entries.set(key, {
    status: resp.status,
    headers: resp.headers,
    body: resp.body,
    expiresAt: Date.now() + TTL_MS,
  });
}

/**
 * Invalidate every entry for the given origin. Called whenever a
 * non-read endpoint is hit on that origin (since the mutation may
 * have changed any cached data). Coarse-grained on purpose:
 * per-entity invalidation would need to know mutation→read mappings,
 * which is fragile when new endpoints land. Cost is one extra round
 * trip per cached entity after a mutation — bounded and acceptable.
 */
export function cacheInvalidateOrigin(url: string): void {
  const parsed = parseUrl(url);
  if (!parsed) return;
  if (cacheByOrigin.delete(parsed.origin)) stats.invalidations++;
}

/** Flush everything. Used by tests and `ano daemon stop` shutdown. */
export function cacheClear(): void {
  cacheByOrigin.clear();
}

/** Test-only: peek at the entry count for an origin. */
export function cacheSize(originUrl: string): number {
  const parsed = parseUrl(originUrl);
  if (!parsed) return 0;
  return cacheByOrigin.get(parsed.origin)?.entries.size ?? 0;
}

// ── Internals ──────────────────────────────────────────────────────

function parseUrl(url: string): { origin: string; path: string } | null {
  try {
    const u = new URL(url);
    return { origin: u.origin, path: u.pathname };
  } catch {
    return null;
  }
}

/**
 * Parse + strip the `/mcp` prefix that every API path carries. So
 * `https://api-us.ano.dev/mcp/list_channels` → path `/list_channels`.
 * Returns null if the URL is malformed or doesn't carry the prefix
 * (caching only applies to /mcp/* paths).
 */
function parseCacheable(url: string): { origin: string; path: string } | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  if (!parsed.path.startsWith("/mcp/")) return null;
  return { origin: parsed.origin, path: parsed.path.substring(4) };
}

function makeKey(
  path: string,
  authHeader: string | undefined,
  bodyJson: string,
): string {
  // Hash auth so the key is bounded length and we don't accidentally
  // log/expose tokens. Body is small JSON, fine to keep verbatim.
  const authHash = authHeader
    ? createHash("sha256").update(authHeader).digest("hex").substring(0, 16)
    : "noauth";
  return `${path}::${authHash}::${bodyJson}`;
}
