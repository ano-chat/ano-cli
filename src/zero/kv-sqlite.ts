/**
 * SQLite-backed kvStore for Zero.
 *
 * Two runtime backends, chosen at load time by `sqlite-runtime.ts`:
 *
 *   - **Node** → `better-sqlite3` (native addon)
 *   - **Bun-compiled binary** → `bun:sqlite` (built into Bun)
 *
 * Both expose the same `CompatDatabase` shape so this file doesn't
 * branch on runtime. The reason for the adapter: `bun build --compile`
 * doesn't bundle Node native addons, so `better-sqlite3` fails to
 * load inside the published Bun-compiled binary — Zero bootstrap
 * silently fails and the daemon reports `zero: off`. The adapter
 * routes Bun to its built-in SQLite instead.
 *
 * Replica location: `~/.cache/ano/zero/<safe-name>.sqlite`. Per-user-
 * scoped so two CLI users on the same machine don't share a replica.
 *
 * The kvStore factory must hand `SQLiteStore` a *synchronous* DB
 * factory (Zero calls it inline during construction). We achieve that
 * by pre-loading the runtime driver once per `createSqliteKvStoreProvider`
 * call via `preloadDatabaseCtor`, then resolving the driver
 * synchronously from cache inside the factory.
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  SQLiteStore,
  type SQLiteDatabase,
  type PreparedStatement,
} from "@rocicorp/zero/sqlite";
import {
  createDatabase,
  preloadDatabaseCtor,
  syncCreateDatabase,
  type CompatDatabase,
  type CompatStatement,
} from "./sqlite-runtime.js";

/**
 * Wrap a runtime-agnostic CompatStatement as Zero's `PreparedStatement`.
 * Both backends are sync; we resolve Promises immediately to match
 * Zero's async-ish interface.
 */
function wrapStatement(stmt: CompatStatement): PreparedStatement {
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

function wrapDatabase(db: CompatDatabase): SQLiteDatabase {
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
      // Caller is expected to unlink the file. We leave file removal
      // to the kvStore's `drop()` method.
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
 * so two users on the same machine don't share a replica.
 */
export function defaultReplicaPath(name: string): string {
  const base = process.env.XDG_CACHE_HOME
    ? `${process.env.XDG_CACHE_HOME}/ano/zero`
    : join(homedir(), ".cache", "ano", "zero");
  return join(base, `${name}.sqlite`);
}

/**
 * Construct a Zero-compatible `StoreProvider`. Returns
 * `{ create, drop }` matching Zero's `kvStore` option.
 *
 * Async (returns a Promise<StoreProvider>) because we pre-load the
 * SQLite driver via the runtime adapter before the first store is
 * created. The caller (`createZeroClient`) awaits this once at Zero
 * bootstrap; from then on, each `create` is synchronous (matches
 * `SQLiteStore`'s factory contract).
 */
export async function createSqliteKvStoreProvider(opts?: {
  /** Override base path (test isolation). */
  pathPrefix?: string;
}) {
  // Pre-load the driver. After this, `syncCreateDatabase` is safe.
  await preloadDatabaseCtor();

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
      // directory tree regardless of Zero's internal naming.
      const filename = resolvePath(name);
      mkdirSync(dirname(filename), { recursive: true });
      return new SQLiteStore(name, () => {
        const db = syncCreateDatabase(filename);
        // WAL mode for better concurrency + crash recovery. Use the
        // adapter's `pragma()` (which routes to better-sqlite3's
        // native pragma() — replacing it with `exec("PRAGMA ...")`
        // empirically regressed Zero replica sync, even though both
        // should set the value identically. The Bun branch of the
        // adapter falls back to exec internally.
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

// Silence unused-warning for the async `createDatabase` export from
// the runtime adapter — kvStore uses the sync variant, but tests
// may still pull the async one in.
void createDatabase;

/**
 * Sanitize a Zero-supplied store name into a valid filename. Zero's
 * names contain `:` (e.g. `rep:user_id:v1`) which is OK on macOS/Linux
 * but rejected on win32. Replace with `_`.
 */
function safeFile(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}
