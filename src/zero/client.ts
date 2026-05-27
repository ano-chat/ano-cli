/**
 * Zero client construction + lifecycle for the CLI daemon.
 *
 * The daemon constructs ONE Zero client per (user, region) at startup
 * and shares it across all dispatched commands. The replica lives on
 * disk under `~/.cache/ano/zero/`. WebSocket sync to the configured
 * `sync-us.ano.dev` (or `sync-eu.ano.dev`) origin maintains real-time
 * freshness.
 *
 * Feature gate: this only runs when ANO_USE_ZERO=1. Until that flag
 * defaults on (probably v2.23.x after staging soak), the CLI's
 * behavior is unchanged — daemon doesn't construct Zero, all commands
 * go through the existing REST + cache path.
 *
 * Auth flow:
 *   - Mint a fresh JWT (via /api/cli/zero-jwt) BEFORE constructing
 *     Zero, since Zero's `auth` option is a plain string.
 *   - Subscribe to `zero.connection.state`. When it transitions to
 *     `needs-auth` (or 401/403 from sync server), mint a fresh JWT
 *     and call `zero.connection.connect({ auth: newToken })`.
 *   - Also refresh proactively before token expiry via the auth
 *     provider's internal clock.
 */
import { Zero } from "@rocicorp/zero";
import { statSync } from "node:fs";
import { cliSchema, type CliSchema } from "./schema.js";
import {
  createSqliteKvStoreProvider,
  defaultReplicaPath,
} from "./kv-sqlite.js";
import { createZeroAuthProvider, type ZeroAuthProvider } from "./auth.js";

export interface ZeroClientOptions {
  /**
   * API base for the JWT mint endpoint, e.g.
   * `https://api-us.ano.dev` for prod-us. Read from the CLI profile.
   */
  apiBaseUrl: string;
  /**
   * Sync origin, e.g. `https://sync-us.ano.dev`. Derived from the
   * user's home_region the same way the desktop does it.
   */
  cacheURL: string;
  /** Long-lived CLI API key (`ano_usr_*`). */
  apiKey: string;
  /**
   * User ID — the Zero client's `userID` context. The daemon resolves
   * this once at startup from the API key (server-side mint endpoint
   * implicitly tells us via the JWT's `sub` claim).
   */
  userId: string;
  /** Optional logger; default is no-op. */
  log?: (event: string, meta: Record<string, unknown>) => void;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Override kvStore base path (tests). */
  kvStorePathPrefix?: string;
}

export interface ZeroClientHandle {
  /** The Zero instance for queries + mutations. */
  zero: Zero<CliSchema>;
  /** Auth provider (exposed for force-refresh on 401s). */
  auth: ZeroAuthProvider;
  /** Best-effort stats for `ano daemon status`. */
  stats(): {
    replicaPath: string;
    replicaSizeBytes: number | null;
    connectionStatus: string;
  };
  /** Close + drop pending writes. Idempotent. */
  dispose(): Promise<void>;
}

/**
 * Construct a Zero client for the CLI daemon. Async because we mint
 * the initial JWT before passing it to `new Zero(...)` — Zero's
 * `auth` option is a string, not a callback.
 *
 * Returns `null` if the initial JWT mint fails (network down, server
 * not deployed, key revoked). Caller falls back to the REST path
 * for the session and logs a clear warning.
 */
export async function createZeroClient(
  opts: ZeroClientOptions,
): Promise<ZeroClientHandle | null> {
  const auth = createZeroAuthProvider({
    apiBaseUrl: opts.apiBaseUrl,
    apiKey: opts.apiKey,
    fetchImpl: opts.fetchImpl,
    log: opts.log,
  });

  const initialToken = await auth.getAuth();
  if (!initialToken) {
    opts.log?.("zero-client: initial mint failed; falling back to REST", {});
    return null;
  }

  const kvStore = createSqliteKvStoreProvider({
    pathPrefix: opts.kvStorePathPrefix,
  });
  const replicaName = `user_${opts.userId}`;
  const replicaPath = defaultReplicaPath(replicaName);

  const zero = new Zero<CliSchema>({
    userID: opts.userId,
    server: opts.cacheURL,
    schema: cliSchema,
    auth: initialToken,
    kvStore,
  });

  // Subscribe to connection state. When Zero transitions to
  // `needs-auth` (server returned 401/403), mint a fresh JWT and
  // re-supply it via `connection.connect`. This keeps the WebSocket
  // alive across token-expiry boundaries without manual intervention.
  let lastStatus: string = "init";
  // ConnectionState is a discriminated union by `name`:
  //   'disconnected' | 'connecting' | 'connected' | 'needs-auth' | 'error' | 'closed'
  zero.connection.state.subscribe((state) => {
    lastStatus = state.name;
    opts.log?.("zero-client: connection state", { name: state.name });
    if (state.name === "needs-auth") {
      void (async () => {
        const fresh = await auth.forceRefresh();
        if (fresh) {
          try {
            await zero.connection.connect({ auth: fresh });
          } catch (err) {
            opts.log?.("zero-client: reconnect failed", {
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }
      })();
    }
  });

  opts.log?.("zero-client: constructed", {
    cache_url: opts.cacheURL,
    replica_path: replicaPath,
  });

  let disposed = false;
  return {
    zero,
    auth,
    stats() {
      let replicaSizeBytes: number | null = null;
      try {
        replicaSizeBytes = statSync(replicaPath).size;
      } catch {
        // file may not exist yet — replica hasn't been bootstrapped
        replicaSizeBytes = null;
      }
      return {
        replicaPath,
        replicaSizeBytes,
        connectionStatus: lastStatus,
      };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      try {
        await zero.close();
      } catch (err) {
        opts.log?.("zero-client: close failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

/**
 * Whether to construct the Zero client at all. Gated by env var so
 * we can ship the scaffold without changing user-facing behavior
 * until we're ready.
 */
export function isZeroEnabled(): boolean {
  const v = process.env.ANO_USE_ZERO;
  return v === "1" || v === "true";
}
