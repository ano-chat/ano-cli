import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  saveSession,
  loadSession,
  deleteSession,
  sessionPath,
} from "./oauth-session.js";

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
});
