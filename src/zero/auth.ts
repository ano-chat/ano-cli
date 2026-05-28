/**
 * Zero JWT token cache + refresh for the CLI daemon.
 *
 * Flow:
 *   1. Daemon needs a Zero JWT to authenticate the sync connection.
 *   2. We mint one from `POST /api/cli/zero-jwt` with the user's
 *      long-lived `ano_usr_*` API key as the Authorization header.
 *   3. The endpoint returns `{ token, expires_at }` where `expires_at`
 *      is a unix-millisecond timestamp ~12 hours from now.
 *   4. We cache the token. Zero's client calls our `getAuth()` on
 *      every WebSocket reconnect; we hand it the cached token IF
 *      it's still valid, otherwise we mint a fresh one.
 *
 * Refresh policy: proactive at 80% of the token lifetime. Means if
 * Zero never calls `getAuth()` for hours, the next sync still has
 * a fresh token. The Zero client itself doesn't refresh; we own it.
 *
 * Why server-side mint (not local sign): the JWT is signed with the
 * server's RSA private key, which the CLI never has access to. The
 * `/api/cli/zero-jwt` endpoint is the only signer.
 *
 * Failure modes:
 *  - Network down: cached token used until it actually expires.
 *  - 401 from mint endpoint: API key revoked / expired / wrong.
 *    Treated as terminal — return null, Zero connection drops, and
 *    the daemon falls back to REST for this session.
 *  - 503 from mint endpoint: Zero auth not configured server-side.
 *    Same handling as 401.
 */
// Inlined contract for `POST /api/cli/zero-jwt`. Mirror of
// `packages/shared/src/api/cli-zero-jwt.ts` in the monorepo. Kept
// inline because the CLI repo doesn't depend on `@ano/shared`
// (separate repos). Update both sides together when changing.
async function createCliZeroJwtRequest({
  apiBaseUrl,
  apiKey,
  fetchImpl,
}: {
  apiBaseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<{ token: string; expires_at: number }> {
  const fetchFn = fetchImpl ?? fetch;
  const url = `${apiBaseUrl.replace(/\/$/, "")}/api/cli/zero-jwt`;
  const res = await fetchFn(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    throw new Error(
      `cli-zero-jwt mint failed: HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ""}`,
    );
  }
  const body = (await res.json()) as { token?: unknown; expires_at?: unknown };
  if (typeof body.token !== "string" || typeof body.expires_at !== "number") {
    throw new Error(
      `cli-zero-jwt mint returned invalid shape: ${JSON.stringify(body).slice(0, 200)}`,
    );
  }
  return { token: body.token, expires_at: body.expires_at };
}

interface CachedToken {
  token: string;
  expiresAt: number; // unix ms
  mintedAt: number; // unix ms — wall-clock at the time we received the token
}

export interface ZeroAuthOptions {
  /** API base, e.g. "https://api-us.ano.dev" or "http://127.0.0.1:3001". */
  apiBaseUrl: string;
  /** Long-lived CLI API key (`ano_usr_*`). */
  apiKey: string;
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch;
  /**
   * Optional logger — receives `{event, ...meta}` payloads. Default
   * is a no-op; the daemon passes its pino-style logger.
   */
  log?: (event: string, meta: Record<string, unknown>) => void;
}

/**
 * Construct a token provider for the Zero client. Returns:
 *
 *   - `getAuth()`: returns a Promise<string | undefined>. Zero calls
 *     this every time it needs to authenticate (open / reconnect).
 *     We return the cached token if fresh, otherwise mint + cache.
 *   - `forceRefresh()`: discards the cache and mints fresh. Used
 *     when the daemon detects a 401 on the WebSocket.
 */
export function createZeroAuthProvider(opts: ZeroAuthOptions) {
  let cached: CachedToken | null = null;
  // Refresh proactively when the token has <20% of its remaining
  // lifetime AT MINT TIME left. We track `mintedAt` per-token, so the
  // math works for any server-chosen TTL (no hardcoded 12h assumption).
  const REFRESH_AT = 0.8;
  // Safety floor: never let a token get within 60s of `expiresAt`
  // regardless of TTL. Protects against very short TTLs (e.g. a test
  // endpoint returning 30s tokens) where 80% would still leave us
  // serving an expired token by the time the next request lands.
  const REFRESH_FLOOR_MS = 60_000;
  const log = opts.log ?? (() => {});

  function isFresh(token: CachedToken | null): token is CachedToken {
    if (!token) return false;
    const lifetime = token.expiresAt - token.mintedAt;
    const refreshThreshold = Math.min(
      token.mintedAt + lifetime * REFRESH_AT,
      token.expiresAt - REFRESH_FLOOR_MS,
    );
    return Date.now() < refreshThreshold;
  }

  async function mintFresh(): Promise<CachedToken | null> {
    try {
      const result = await createCliZeroJwtRequest({
        apiBaseUrl: opts.apiBaseUrl,
        apiKey: opts.apiKey,
        fetchImpl: opts.fetchImpl,
      });
      const fresh: CachedToken = {
        token: result.token,
        expiresAt: result.expires_at,
        mintedAt: Date.now(),
      };
      cached = fresh;
      log("zero-auth: minted", {
        expires_at: fresh.expiresAt,
        ttl_seconds: Math.round((fresh.expiresAt - Date.now()) / 1000),
      });
      return fresh;
    } catch (err) {
      log("zero-auth: mint failed", {
        message: err instanceof Error ? err.message : String(err),
      });
      cached = null;
      return null;
    }
  }

  return {
    async getAuth(): Promise<string | undefined> {
      if (isFresh(cached)) return cached.token;
      const fresh = await mintFresh();
      return fresh?.token;
    },

    async forceRefresh(): Promise<string | undefined> {
      cached = null;
      const fresh = await mintFresh();
      return fresh?.token;
    },

    /** Test-only: peek at the cached token without minting. */
    _peekCached(): CachedToken | null {
      return cached;
    },

    /** Test-only: clear the cache. */
    _clear(): void {
      cached = null;
    },
  };
}

export type ZeroAuthProvider = ReturnType<typeof createZeroAuthProvider>;
