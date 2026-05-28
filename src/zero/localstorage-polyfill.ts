/**
 * Minimal `localStorage` polyfill for the daemon process.
 *
 * Zero (`@rocicorp/zero`) is browser-first: its replicache foundation
 * reads/writes `globalThis.localStorage.getItem("profileId")` at
 * construction time. In Node + Bun, that global is missing OR a stub
 * that doesn't implement the API:
 *
 *   - **Node 22+** ships an experimental `localStorage` global that's
 *     only functional when started with `--localstorage-file=<path>`.
 *     Without the flag, the global exists (truthy) but `.getItem` is
 *     missing, producing:
 *       TypeError: maybeLocalStorage.getItem is not a function
 *     at idb-databases-store.js:68. The Zero constructor throws, the
 *     daemon's bootstrap swallows it via `.catch(() => {})`, and
 *     `ano daemon status` reports "zero: off (bootstrap failed)" with
 *     no obvious cause.
 *
 *   - **Bun-compiled** has its own partial impl with similar quirks
 *     depending on the runtime version. Either way Zero can't trust
 *     the global, so we override.
 *
 * Polyfill scope:
 *   - In-memory `Map<string, string>` backing — Zero only stores a
 *     `profileId` here, which is a routing key for its IDB layer.
 *     Since we use SQLite (`createSqliteKvStoreProvider`) as the
 *     actual kvStore, the profileId is non-load-bearing for us; if
 *     we lose it across daemon restarts, Zero just allocates a fresh
 *     one. Acceptable.
 *   - Persists the profileId to disk under `~/.cache/ano/zero/
 *     profile-id` so subsequent daemon starts reuse it. Keeps Zero
 *     happy when it expects the same profile across restarts.
 *
 * Call `installLocalStoragePolyfill()` exactly once before importing
 * `@rocicorp/zero`. It's a no-op if a functional `localStorage` is
 * already in place (i.e. a browser test harness or future runtime
 * that ships a real one).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

let installed = false;

export function installLocalStoragePolyfill(): void {
  if (installed) return;

  // Detect a functional localStorage. The Node experimental impl is
  // truthy but missing methods; the Bun impl varies. Check for the
  // methods Zero actually uses (`getItem` + `setItem`).
  const existing = (globalThis as { localStorage?: unknown }).localStorage;
  if (
    existing &&
    typeof (existing as { getItem?: unknown }).getItem === "function" &&
    typeof (existing as { setItem?: unknown }).setItem === "function"
  ) {
    installed = true;
    return;
  }

  // Use the same cache root as our Zero replica so cleanup is uniform.
  const cacheBase = process.env.XDG_CACHE_HOME
    ? `${process.env.XDG_CACHE_HOME}/ano/zero`
    : join(homedir(), ".cache", "ano", "zero");
  const profileIdPath = join(cacheBase, "profile-id");

  const store = new Map<string, string>();

  // Seed `profileId` from disk if present. Zero generates one on first
  // run; we persist it so a daemon restart doesn't start a fresh
  // logical Zero profile (which would rebuild internal IDB state).
  try {
    const persisted = readFileSync(profileIdPath, "utf8").trim();
    if (persisted) store.set("profileId", persisted);
  } catch {
    // file doesn't exist yet — Zero will create one on first setItem
  }

  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: {
        getItem(key: string): string | null {
          return store.has(key) ? (store.get(key) as string) : null;
        },
        setItem(key: string, value: string): void {
          const v = String(value);
          store.set(key, v);
          // Persist only `profileId` — the only key Zero actually
          // writes here, and the only one that matters across restarts.
          // Other keys (if any) stay in-memory.
          if (key === "profileId") {
            try {
              mkdirSync(dirname(profileIdPath), { recursive: true });
              writeFileSync(profileIdPath, v, { mode: 0o600 });
            } catch {
              // best-effort — losing persistence just means Zero
              // re-allocates on next start.
            }
          }
        },
        removeItem(key: string): void {
          store.delete(key);
        },
        clear(): void {
          store.clear();
        },
        key(index: number): string | null {
          return [...store.keys()][index] ?? null;
        },
        get length(): number {
          return store.size;
        },
      },
    });
    installed = true;
  } catch {
    // defineProperty failed (e.g. localStorage is a non-configurable
    // global). Leave `installed = false` so the next caller can retry;
    // Zero will error loudly when it touches `getItem`, which is
    // still a better outcome than silently masking the install.
  }
}
