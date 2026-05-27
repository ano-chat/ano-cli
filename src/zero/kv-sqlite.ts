/**
 * SQLite-backed kvStore for Zero, using `better-sqlite3` (a synchronous
 * Node-compatible SQLite binding). Zero ships a generic `SQLiteStore`
 * that takes a factory for any SQLite implementation; this file
 * provides the `better-sqlite3`-flavored factory.
 *
 * Why better-sqlite3 instead of `bun:sqlite`:
 *  - Works in both Bun (compiled binary) AND Node (npm-installed JS
 *    shim). One implementation, one code path.
 *  - Native binding — fast (microsecond reads).
 *  - Synchronous API — Zero's `SQLiteDatabase` interface returns
 *    Promises, but we resolve them immediately, which is fine.
 *
 * Replica location: `~/.cache/ano/zero/<user-or-anon>.sqlite`. Per-
 * user-scoped so two CLI users on the same machine don't share a
 * replica.
 */
import Database from "better-sqlite3";
import type { Database as BetterDb, Statement } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  SQLiteStore,
  type SQLiteDatabase,
  type PreparedStatement,
} from "@rocicorp/zero/sqlite";

/**
 * Wrap a `better-sqlite3` Statement as Zero's `PreparedStatement`.
 * better-sqlite3 is sync; we resolve Promises immediately to match
 * Zero's async-ish interface.
 */
function wrapStatement(stmt: Statement): PreparedStatement {
  return {
    firstValue: async (params: string[]) => {
      const row = stmt.get(...params) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      // SQLiteStore expects the first column's value.
      const values = Object.values(row);
      return values.length > 0 ? values[0] : undefined;
    },
    exec: async (params: string[]) => {
      stmt.run(...params);
    },
  };
}

function wrapDatabase(db: BetterDb): SQLiteDatabase {
  let closed = false;
  let destroyed = false;
  return {
    close() {
      if (closed) return;
      closed = true;
      try {
        db.close();
      } catch {
        // ignore
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      this.close();
      // Caller is expected to unlink the file. better-sqlite3 has no
      // built-in destroy; we leave file removal to the kvStore code.
    },
    prepare(sql: string) {
      return wrapStatement(db.prepare(sql));
    },
    execSync(sql: string) {
      db.exec(sql);
    },
  };
}

/**
 * Resolve the on-disk path for a Zero replica file. Per-user-scoped
 * so two users on the same machine don't share a replica. The user
 * identifier comes from the API key's hash so we don't have to
 * persist user-id mappings client-side.
 */
export function defaultReplicaPath(name: string): string {
  const base = process.env.XDG_CACHE_HOME
    ? `${process.env.XDG_CACHE_HOME}/ano/zero`
    : join(homedir(), ".cache", "ano", "zero");
  return join(base, `${name}.sqlite`);
}

/**
 * Construct a Zero-compatible `StoreProvider`. Returns `{ create, drop }`
 * matching Zero's `kvStore` option. Zero may instantiate multiple stores
 * over the lifetime of a client (per userID, per schema version) — this
 * factory routes each call to a separate SQLite file at
 * `~/.cache/ano/zero/<safe-name>.sqlite`.
 */
export function createSqliteKvStoreProvider(opts?: {
  /** Override base path (test isolation). */
  pathPrefix?: string;
}) {
  function resolvePath(name: string): string {
    return opts?.pathPrefix
      ? join(opts.pathPrefix, `${safeFile(name)}.sqlite`)
      : defaultReplicaPath(safeFile(name));
  }
  return {
    create(name: string) {
      // SQLiteStore calls our factory with its own `fname` (derived
      // from the `name` we pass to it). We IGNORE that fname and use
      // our resolved path — keeps all replicas in the configured
      // directory tree regardless of Zero's internal naming. The
      // factory receives a name but we map it to our own path.
      const filename = resolvePath(name);
      mkdirSync(dirname(filename), { recursive: true });
      return new SQLiteStore(name, () => {
        const db = new Database(filename);
        // WAL mode for better concurrency + crash recovery. Same as
        // what most Zero embedders use.
        db.pragma("journal_mode = WAL");
        db.pragma("synchronous = NORMAL");
        return wrapDatabase(db);
      });
    },
    async drop(name: string) {
      const filename = resolvePath(name);
      try {
        const { unlinkSync } = await import("node:fs");
        unlinkSync(filename);
        // SQLite WAL also creates -wal and -shm files; clean those.
        try {
          unlinkSync(`${filename}-wal`);
        } catch {
          // ignore
        }
        try {
          unlinkSync(`${filename}-shm`);
        } catch {
          // ignore
        }
      } catch {
        // already gone — fine
      }
    },
  };
}

/**
 * Sanitize a Zero-supplied store name into a valid filename. Zero's
 * names contain `:` (e.g. `rep:user_id:v1`) which is OK on macOS/Linux
 * but rejected on win32. Replace with `_`.
 */
function safeFile(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}
