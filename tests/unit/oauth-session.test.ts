import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  saveSession,
  loadSession,
  deleteSession,
  sessionPath,
  assertSessionPathSafe,
} from "../../src/core/oauth-session.js";

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "ano-session-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("oauth-session", () => {
  it("returns null when no session has been saved", () => {
    expect(loadSession()).toBeNull();
  });

  it("round-trips a session via save/load", () => {
    const session = {
      accessToken: "tok_abc",
      endpoint: "https://api-staging.ano.dev",
      clientId: "client_01TEST",
      createdAt: Date.now(),
      userId: "user_123",
    };
    saveSession(session);
    expect(loadSession()).toEqual(session);
  });

  it("writes the session file with mode 0o600", () => {
    saveSession({
      accessToken: "t",
      endpoint: "e",
      clientId: "c",
      createdAt: Date.now(),
    });
    const stat = statSync(sessionPath());
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("creates the parent dir with mode 0o700 if missing", () => {
    saveSession({
      accessToken: "t",
      endpoint: "e",
      clientId: "c",
      createdAt: Date.now(),
    });
    const stat = statSync(dirname(sessionPath()));
    expect(stat.mode & 0o777).toBe(0o700);
  });

  it("returns null when the cached session is older than 5 minutes", () => {
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
    saveSession({
      accessToken: "t",
      endpoint: "e",
      clientId: "c",
      createdAt: sixMinutesAgo,
    });
    expect(loadSession()).toBeNull();
  });

  it("returns null when the cached session is missing required fields", () => {
    // Manually write a malformed session (e.g. missing accessToken).
    saveSession({
      accessToken: "t",
      endpoint: "e",
      clientId: "c",
      createdAt: Date.now(),
    });
    writeFileSync(sessionPath(), JSON.stringify({ endpoint: "e" }), {
      mode: 0o600,
    });
    expect(loadSession()).toBeNull();
  });

  it("returns null when the cached session is malformed JSON", () => {
    saveSession({
      accessToken: "t",
      endpoint: "e",
      clientId: "c",
      createdAt: Date.now(),
    });
    writeFileSync(sessionPath(), "not json", { mode: 0o600 });
    expect(loadSession()).toBeNull();
  });

  it("deleteSession removes the cached file", () => {
    saveSession({
      accessToken: "t",
      endpoint: "e",
      clientId: "c",
      createdAt: Date.now(),
    });
    expect(loadSession()).not.toBeNull();
    deleteSession();
    expect(loadSession()).toBeNull();
  });

  it("deleteSession is idempotent when no session exists", () => {
    expect(() => deleteSession()).not.toThrow();
    expect(() => deleteSession()).not.toThrow();
  });

  it("written file content is the JSON we passed in", () => {
    const session = {
      accessToken: "tok_xyz",
      endpoint: "https://api-staging.ano.dev",
      clientId: "client_01TEST",
      createdAt: 1730000000000,
    };
    saveSession(session);
    const raw = readFileSync(sessionPath(), "utf-8");
    expect(JSON.parse(raw)).toEqual(session);
  });
});

describe("oauth-session — symlink defenses", () => {
  it("saveSession refuses to write through a pre-seeded symlink at the session path", () => {
    // Attacker pre-creates the session path as a symlink to a canary file.
    const canary = join(tmpHome, "canary.txt");
    writeFileSync(canary, "DO NOT TOUCH");
    mkdirSync(dirname(sessionPath()), { recursive: true, mode: 0o700 });
    symlinkSync(canary, sessionPath());

    expect(() =>
      saveSession({
        accessToken: "would-clobber",
        endpoint: "e",
        clientId: "c",
        createdAt: Date.now(),
      }),
    ).toThrow(/symbolic link/);

    // Canary must be unchanged.
    expect(readFileSync(canary, "utf-8")).toBe("DO NOT TOUCH");
  });

  it("saveSession refuses to follow a pre-seeded symlink at the .tmp sibling", () => {
    const canary = join(tmpHome, "canary.txt");
    writeFileSync(canary, "DO NOT TOUCH");
    mkdirSync(dirname(sessionPath()), { recursive: true, mode: 0o700 });
    symlinkSync(canary, sessionPath() + ".tmp");

    expect(() =>
      saveSession({
        accessToken: "would-clobber",
        endpoint: "e",
        clientId: "c",
        createdAt: Date.now(),
      }),
    ).toThrow(/symbolic link/);

    expect(readFileSync(canary, "utf-8")).toBe("DO NOT TOUCH");
    // Session file at the real path was never created (we threw before
    // any open).
    expect(existsSync(sessionPath())).toBe(false);
  });

  it("loadSession returns null when session path is a symlink (rather than reading through)", () => {
    const canary = join(tmpHome, "canary.txt");
    writeFileSync(
      canary,
      '{"accessToken":"leaked","endpoint":"e","clientId":"c","createdAt":' +
        Date.now() +
        "}",
    );
    mkdirSync(dirname(sessionPath()), { recursive: true, mode: 0o700 });
    symlinkSync(canary, sessionPath());

    expect(loadSession()).toBeNull();
  });

  it("assertSessionPathSafe is a no-op when no session/.tmp exists", () => {
    expect(() => assertSessionPathSafe()).not.toThrow();
  });

  it("saveSession overwrites a stale plain-file .tmp leftover from a prior crash", () => {
    mkdirSync(dirname(sessionPath()), { recursive: true, mode: 0o700 });
    writeFileSync(sessionPath() + ".tmp", "stale", { mode: 0o600 });

    saveSession({
      accessToken: "fresh",
      endpoint: "e",
      clientId: "c",
      createdAt: Date.now(),
    });

    const session = loadSession();
    expect(session?.accessToken).toBe("fresh");
    // .tmp must be gone after rename.
    expect(existsSync(sessionPath() + ".tmp")).toBe(false);
  });
});
