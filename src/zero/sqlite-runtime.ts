/**
 * Runtime-agnostic SQLite adapter.
 *
 * The CLI runs in two distinct contexts and Zero's SQLite kvStore needs
 * to work in both:
 *
 * 1. **Node** (`npm install -g` JS path) — uses `better-sqlite3`, a
 *    native Node addon. Loaded via `require()` of a `.node` binary.
 *
 * 2. **Bun-compiled binary** (`bun build --compile` output) — the
 *    runtime is Bun, but the binary is a single static executable
 *    with NO node_modules. Bun's `bun build --compile` doesn't bundle
 *    Node native addons (the `.node` file isn't included), so
 *    `better-sqlite3` fails to load at runtime → Zero bootstrap fails
 *    silently → daemon falsely reports `zero: off`. This was the
 *    Bun-only blocker on v2.23.1.
 *
 *    Bun ships `bun:sqlite` as a built-in module — always available,
 *    no native addons required, sync API similar enough to
 *    `better-sqlite3` that we can paper over the differences.
 *
 * Detection: `globalThis.Bun` is set in Bun (runtime AND compiled
 * binary). When present, use `bun:sqlite`; otherwise `better-sqlite3`.
 *
 * Surface: the adapter exposes only the methods this codebase uses
 * (`exec`, `prepare`, `close`, plus a `.get`/`.run` on statements).
 * Both backends' types are erased behind a single
 * `CompatDatabase`/`CompatStatement` shape so kv-sqlite.ts doesn't
 * branch on runtime.
 */

export interface CompatStatement {
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): void;
}

export interface CompatDatabase {
  prepare(sql: string): CompatStatement;
  exec(sql: string): void;
  close(): void;
  /**
   * Set a PRAGMA. better-sqlite3 has a dedicated `db.pragma()` that
   * routes through its native binding (and apparently has subtle
   * side effects exec doesn't replicate — replacing it with
   * `exec("PRAGMA ...")` regressed Zero replica sync). bun:sqlite
   * has no `pragma()` shortcut, so the adapter falls back to exec
   * for that backend. Both end up setting the pragma; only the
   * code path differs.
   */
  pragma(setting: string): void;
}

// Cached factory FUNCTION (not constructor). Resolved lazily so the
// import side-effect (loading better-sqlite3's native addon) doesn't
// happen at module-load time. Particularly important for Bun-compiled
// binaries where the `better-sqlite3` require would throw at load
// and crash the whole CLI.
type DatabaseFactory = (filename: string) => CompatDatabase;
let cachedFactory: DatabaseFactory | null = null;

async function resolveDatabaseFactory(): Promise<DatabaseFactory> {
  if (cachedFactory) return cachedFactory;

  if ("Bun" in globalThis) {
    // bun:sqlite is built into Bun. Same Database constructor shape
    // as better-sqlite3 (`new Database(filename)`). Methods are
    // close-enough — see the wrapper below for the deltas.
    //
    // Cast through `unknown` because bun:sqlite isn't a Node module
    // and has no @types/* in scope when building under Node.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import("bun:sqlite" as any);
    const BunDatabase = (mod as { Database: new (f: string) => unknown })
      .Database;
    cachedFactory = (filename: string) =>
      wrapBunDatabase(new BunDatabase(filename));
    return cachedFactory;
  }

  // Node path: better-sqlite3 default export.
  const mod = await import("better-sqlite3");
  const BetterDatabase = mod.default;
  cachedFactory = (filename: string) =>
    wrapBetterDatabase(
      new BetterDatabase(filename) as unknown as BetterSqliteDb,
    );
  return cachedFactory;
}

/**
 * Construct a SQLite database the kvStore can use. Async because
 * loading the underlying driver is async (dynamic import).
 *
 * Most callers want the SYNC variant below: pre-load the driver
 * once via `preloadDatabaseCtor`, then call `syncCreateDatabase`
 * from wherever a sync factory is expected (e.g. Zero's
 * `SQLiteStore` constructor).
 */
export async function createDatabase(
  filename: string,
): Promise<CompatDatabase> {
  const factory = await resolveDatabaseFactory();
  return factory(filename);
}

/**
 * Pre-load the SQLite driver. Resolves when the factory is cached
 * and `syncCreateDatabase` is safe to call. The kvStore provider
 * awaits this once at Zero bootstrap; subsequent store creations
 * are synchronous (Zero's `SQLiteStore` factory contract).
 */
export async function preloadDatabaseCtor(): Promise<void> {
  await resolveDatabaseFactory();
}

/**
 * Synchronous database construction. Throws if `preloadDatabaseCtor`
 * hasn't completed first — guard against that at the caller (we do,
 * in `createSqliteKvStoreProvider`).
 */
export function syncCreateDatabase(filename: string): CompatDatabase {
  if (!cachedFactory) {
    throw new Error(
      "sqlite-runtime: must call preloadDatabaseCtor() before syncCreateDatabase()",
    );
  }
  return cachedFactory(filename);
}

// ── better-sqlite3 wrapper ─────────────────────────────────────────

interface BetterSqliteDb {
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    run(...args: unknown[]): unknown;
  };
  pragma(setting: string): unknown;
  exec(sql: string): void;
  close(): void;
}

function wrapBetterDatabase(db: BetterSqliteDb): CompatDatabase {
  return {
    prepare(sql: string): CompatStatement {
      const stmt = db.prepare(sql);
      return {
        get(...params: unknown[]) {
          return stmt.get(...params);
        },
        run(...params: unknown[]) {
          stmt.run(...params);
        },
      };
    },
    exec(sql: string) {
      db.exec(sql);
    },
    close() {
      db.close();
    },
    pragma(setting: string) {
      db.pragma(setting);
    },
  };
}

// ── bun:sqlite wrapper ─────────────────────────────────────────────

interface BunSqliteDb {
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    run(...args: unknown[]): unknown;
  };
  exec(sql: string): void;
  close(): void;
}

function wrapBunDatabase(db: unknown): CompatDatabase {
  const bdb = db as BunSqliteDb;
  return {
    prepare(sql: string): CompatStatement {
      const stmt = bdb.prepare(sql);
      return {
        get(...params: unknown[]) {
          return stmt.get(...params);
        },
        run(...params: unknown[]) {
          stmt.run(...params);
        },
      };
    },
    exec(sql: string) {
      bdb.exec(sql);
    },
    close() {
      bdb.close();
    },
    pragma(setting: string) {
      // bun:sqlite has no dedicated `pragma()`; PRAGMA-via-exec
      // works for the settings we use (journal_mode, synchronous).
      bdb.exec(`PRAGMA ${setting};`);
    },
  };
}
