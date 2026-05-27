/**
 * Tests for the SQLite-backed kvStore. We exercise the StoreProvider
 * surface: create returns a working Zero `Store`, drop removes the
 * on-disk file, multiple stores per provider don't collide.
 *
 * These tests use a tempdir for isolation — they don't touch
 * `~/.cache/ano/`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSqliteKvStoreProvider,
  defaultReplicaPath,
} from "../../src/zero/kv-sqlite.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zero-kv-test-"));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("createSqliteKvStoreProvider", () => {
  it("create + write + read round-trips a value", async () => {
    const provider = createSqliteKvStoreProvider({ pathPrefix: dir });
    const store = provider.create("test_store");

    // Write
    const write = await store.write();
    await write.put("key1", "value1");
    await write.commit();
    write.release();

    // Read
    const read = await store.read();
    const value = await read.get("key1");
    expect(value).toBe("value1");
    read.release();

    await store.close();
  });

  it("isolates two stores in the same provider", async () => {
    const provider = createSqliteKvStoreProvider({ pathPrefix: dir });
    const a = provider.create("alpha");
    const b = provider.create("beta");

    const wa = await a.write();
    await wa.put("k", "alpha-value");
    await wa.commit();
    wa.release();

    const wb = await b.write();
    await wb.put("k", "beta-value");
    await wb.commit();
    wb.release();

    const ra = await a.read();
    expect(await ra.get("k")).toBe("alpha-value");
    ra.release();

    const rb = await b.read();
    expect(await rb.get("k")).toBe("beta-value");
    rb.release();

    await a.close();
    await b.close();
  });

  it("drop removes the on-disk file (+ WAL sidecars)", async () => {
    const provider = createSqliteKvStoreProvider({ pathPrefix: dir });
    const store = provider.create("droppable");

    const write = await store.write();
    await write.put("k", "v");
    await write.commit();
    write.release();
    await store.close();

    const filesBefore = readdirSync(dir);
    expect(filesBefore.some((f) => f.startsWith("droppable"))).toBe(true);

    await provider.drop("droppable");

    const filesAfter = readdirSync(dir);
    expect(filesAfter.some((f) => f.startsWith("droppable"))).toBe(false);
  });

  it("drop on a non-existent store is a no-op (no throw)", async () => {
    const provider = createSqliteKvStoreProvider({ pathPrefix: dir });
    // Should resolve, not throw.
    await expect(provider.drop("doesnotexist")).resolves.toBeUndefined();
  });

  it("sanitizes Zero-supplied names with `:` into valid filenames", async () => {
    const provider = createSqliteKvStoreProvider({ pathPrefix: dir });
    // Zero uses names like "rep:userId:v1" — colons break Windows
    // and confuse some shell paths.
    const store = provider.create("rep:user_alice:v1");

    const w = await store.write();
    await w.put("k", "v");
    await w.commit();
    w.release();
    await store.close();

    const files = readdirSync(dir);
    // Should be sanitized — no colons, no spaces.
    expect(files.some((f) => !/[:]/.test(f) && f.includes("rep_"))).toBe(true);
  });
});

describe("defaultReplicaPath", () => {
  it("respects XDG_CACHE_HOME", () => {
    const original = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = "/some/xdg";
    try {
      expect(defaultReplicaPath("alice")).toBe(
        "/some/xdg/ano/zero/alice.sqlite",
      );
    } finally {
      if (original === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = original;
    }
  });

  it("falls back to ~/.cache/ano/zero when XDG_CACHE_HOME unset", () => {
    const original = process.env.XDG_CACHE_HOME;
    delete process.env.XDG_CACHE_HOME;
    try {
      const path = defaultReplicaPath("bob");
      expect(path).toMatch(/\/\.cache\/ano\/zero\/bob\.sqlite$/);
    } finally {
      if (original !== undefined) process.env.XDG_CACHE_HOME = original;
    }
  });
});

describe("isolation across provider instances", () => {
  it("two providers with the same pathPrefix DO share data", async () => {
    // This is by design — `pathPrefix` is what makes them "the same
    // provider" logically. Two CLI processes pointing at the same
    // pathPrefix WILL share a replica.
    const a = createSqliteKvStoreProvider({ pathPrefix: dir });
    const b = createSqliteKvStoreProvider({ pathPrefix: dir });

    const sa = a.create("shared");
    const w = await sa.write();
    await w.put("k", "from-a");
    await w.commit();
    w.release();
    await sa.close();

    const sb = b.create("shared");
    const r = await sb.read();
    expect(await r.get("k")).toBe("from-a");
    r.release();
    await sb.close();
  });

  it("two providers with DIFFERENT prefixes are isolated", async () => {
    const dirB = mkdtempSync(join(tmpdir(), "zero-kv-isolated-b-"));
    try {
      const a = createSqliteKvStoreProvider({ pathPrefix: dir });
      const b = createSqliteKvStoreProvider({ pathPrefix: dirB });

      const sa = a.create("x");
      const wa = await sa.write();
      await wa.put("k", "value-a");
      await wa.commit();
      wa.release();
      await sa.close();

      const sb = b.create("x");
      const rb = await sb.read();
      expect(await rb.get("k")).toBeUndefined();
      rb.release();
      await sb.close();
    } finally {
      rmSync(dirB, { recursive: true, force: true });
    }
  });
});
