import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Tests for the localStorage polyfill that makes Zero's
 * idb-databases-store usable from Node/Bun. Without the polyfill,
 * Zero crashes at construction with
 * "TypeError: maybeLocalStorage.getItem is not a function" (Node 22+
 * with experimental localStorage) or silently fails (Bun-compiled
 * binary).
 *
 * Tests use `XDG_CACHE_HOME` override to isolate the on-disk
 * profile-id file from the real cache dir.
 */
describe("localstorage-polyfill", () => {
  let tmpCache: string;
  const origCache = process.env.XDG_CACHE_HOME;

  beforeEach(() => {
    tmpCache = mkdtempSync(join(tmpdir(), "ano-zero-poly-"));
    process.env.XDG_CACHE_HOME = tmpCache;
    // Wipe any state from previous test
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  afterEach(() => {
    if (origCache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = origCache;
    try {
      rmSync(tmpCache, { recursive: true });
    } catch {
      // best effort
    }
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("installs a localStorage with getItem/setItem when missing", async () => {
    const { installLocalStoragePolyfill } = await import(
      "../../src/zero/localstorage-polyfill.js?test1=" + Date.now()
    );
    installLocalStoragePolyfill();
    expect(typeof globalThis.localStorage).toBe("object");
    expect(typeof globalThis.localStorage.getItem).toBe("function");
    expect(typeof globalThis.localStorage.setItem).toBe("function");
  });

  it("getItem returns null for missing keys (matches browser spec)", async () => {
    const { installLocalStoragePolyfill } = await import(
      "../../src/zero/localstorage-polyfill.js?test2=" + Date.now()
    );
    installLocalStoragePolyfill();
    expect(globalThis.localStorage.getItem("nope")).toBeNull();
  });

  it("round-trips getItem after setItem", async () => {
    const { installLocalStoragePolyfill } = await import(
      "../../src/zero/localstorage-polyfill.js?test3=" + Date.now()
    );
    installLocalStoragePolyfill();
    globalThis.localStorage.setItem("k1", "v1");
    expect(globalThis.localStorage.getItem("k1")).toBe("v1");
  });

  it("persists `profileId` to disk for cross-restart continuity", async () => {
    const { installLocalStoragePolyfill } = await import(
      "../../src/zero/localstorage-polyfill.js?test4=" + Date.now()
    );
    installLocalStoragePolyfill();
    globalThis.localStorage.setItem("profileId", "p-test-12345");
    expect(existsSync(join(tmpCache, "ano/zero/profile-id"))).toBe(true);
  });

  it("does NOT persist non-profileId keys to disk (in-memory only)", async () => {
    const { installLocalStoragePolyfill } = await import(
      "../../src/zero/localstorage-polyfill.js?test5=" + Date.now()
    );
    installLocalStoragePolyfill();
    globalThis.localStorage.setItem("other", "value");
    // profile-id file should NOT exist
    expect(existsSync(join(tmpCache, "ano/zero/profile-id"))).toBe(false);
    // But it should be readable in-memory
    expect(globalThis.localStorage.getItem("other")).toBe("value");
  });

  it("does NOT clobber an existing functional localStorage", async () => {
    const realStore = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: {
        getItem: (k: string) => realStore.get(k) ?? null,
        setItem: (k: string, v: string) => realStore.set(k, v),
        removeItem: (k: string) => realStore.delete(k),
        clear: () => realStore.clear(),
        key: () => null,
        get length() {
          return realStore.size;
        },
      },
    });
    const ref = globalThis.localStorage;
    const { installLocalStoragePolyfill } = await import(
      "../../src/zero/localstorage-polyfill.js?test6=" + Date.now()
    );
    installLocalStoragePolyfill();
    // Same reference — polyfill detected a functional impl and bailed.
    expect(globalThis.localStorage).toBe(ref);
  });

  it("DOES clobber a non-functional localStorage (e.g. Node's experimental impl with no flag)", async () => {
    // Simulate the Node 22+ case: localStorage exists but methods missing.
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: {}, // truthy but no getItem/setItem
    });
    const { installLocalStoragePolyfill } = await import(
      "../../src/zero/localstorage-polyfill.js?test7=" + Date.now()
    );
    installLocalStoragePolyfill();
    expect(typeof globalThis.localStorage.getItem).toBe("function");
    expect(globalThis.localStorage.getItem("anything")).toBeNull();
  });
});
