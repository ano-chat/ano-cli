import { describe, it, expect } from "vitest";
import {
  deriveRegion,
  formatBytes,
  computeZeroHealth,
  computeVerdict,
  type ZeroHealth,
  type HealthReport,
} from "../../src/cli/commands/daemon/index.js";

describe("deriveRegion", () => {
  it("maps regional + special endpoints", () => {
    expect(deriveRegion("https://api-us.ano.dev")).toBe("us");
    expect(deriveRegion("https://api-eu.ano.dev")).toBe("eu");
    expect(deriveRegion("https://api-staging.ano.dev")).toBe("staging");
    expect(deriveRegion("http://localhost:3001")).toBe("local");
    expect(deriveRegion("http://127.0.0.1:3001")).toBe("local");
    expect(deriveRegion("https://api.ano.dev")).toBe("apex(!)");
    expect(deriveRegion("not a url")).toBe("?");
  });
});

describe("formatBytes", () => {
  it("renders sizes and the null/undefined sentinel", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(68_000)).toBe("66 KB");
    expect(formatBytes(2_500_000)).toBe("2.4 MB");
  });
});

describe("computeZeroHealth", () => {
  it("is cold (not fast) when the daemon is down", () => {
    const z = computeZeroHealth(false, undefined);
    expect(z.enabled).toBe(false);
    expect(z.fast).toBe(false);
    expect(z.readsVerdict).toMatch(/cold/);
  });

  it("is REST-only when the daemon is up but Zero is off", () => {
    const z = computeZeroHealth(true, undefined);
    expect(z.enabled).toBe(false);
    expect(z.fast).toBe(false);
    expect(z.readsVerdict).toMatch(/REST/);
  });

  it("is warm (fast) when connected with no drift", () => {
    const z = computeZeroHealth(true, {
      status: "connected",
      replicaPath: "/x",
      replicaSizeBytes: 68_000,
      drifted: [],
    });
    expect(z.fast).toBe(true);
    expect(z.readsVerdict).toMatch(/warm local replica/);
  });

  it("is NOT fast when a table has drifted (REST fallback)", () => {
    const z = computeZeroHealth(true, {
      status: "connected",
      replicaPath: "/x",
      replicaSizeBytes: 1,
      drifted: [{ table: "messages", reason: "schema mismatch" }],
    });
    expect(z.fast).toBe(false);
    expect(z.readsVerdict).toMatch(/messages/);
  });

  it("is NOT fast when connecting/needs-auth", () => {
    const z = computeZeroHealth(true, {
      status: "connecting",
      replicaPath: "/x",
      replicaSizeBytes: 0,
      drifted: [],
    });
    expect(z.fast).toBe(false);
  });
});

describe("computeVerdict", () => {
  const okZero: ZeroHealth = {
    enabled: true,
    status: "connected",
    drifted: [],
    readsVerdict: "warm",
    fast: true,
  };
  const base = {
    auth: { ok: true } as HealthReport["auth"],
    daemon: {
      running: true,
      socket: "/s",
      breaker: false,
    } as HealthReport["daemon"],
    zero: okZero,
    api: {
      ok: true,
      endpoint: "https://api-us.ano.dev",
    } as HealthReport["api"],
    cli: { version: "2.25.5", runtime: "native arm64", stale: false },
  };

  it("fails when auth is missing", () => {
    expect(computeVerdict({ ...base, auth: { ok: false } }).status).toBe(
      "fail",
    );
  });

  it("fails when the API is unreachable", () => {
    expect(
      computeVerdict({
        ...base,
        api: { ok: false, endpoint: "x", error: "timeout" },
      }).status,
    ).toBe("fail");
  });

  it("warns when the daemon is down", () => {
    const v = computeVerdict({
      ...base,
      daemon: { running: false, socket: "/s", breaker: false },
    });
    expect(v.status).toBe("warn");
    expect(v.summary).toMatch(/daemon down/);
  });

  it("warns when reads are on REST fallback", () => {
    const v = computeVerdict({ ...base, zero: { ...okZero, fast: false } });
    expect(v.status).toBe("warn");
    expect(v.summary).toMatch(/REST fallback/);
  });

  it("warns when the daemon is a stale version", () => {
    const v = computeVerdict({
      ...base,
      cli: {
        version: "2.25.5",
        runtime: "native arm64",
        daemonVersion: "2.25.3",
        stale: true,
      },
    });
    expect(v.status).toBe("warn");
    expect(v.summary).toMatch(/stale/);
  });

  it("passes when everything is healthy", () => {
    expect(computeVerdict(base).status).toBe("pass");
  });
});
