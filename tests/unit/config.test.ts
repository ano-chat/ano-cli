/**
 * Tests for `src/core/config.ts`. Regression coverage for the v2.16.2
 * fix: `configDir()` must resolve from `os.homedir()` per call, not be
 * cached at module load. Required because the daemon temporarily
 * replaces `process.env` (including HOME) with the caller's env when
 * dispatching from a HOME-redirected PTY shell.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configDir,
  loadGlobalCredentials,
  saveGlobalCredentials,
} from "../../src/core/config.js";

const ORIGINAL_HOME = process.env.HOME;

beforeEach(() => {
  delete process.env.HOME;
  if (ORIGINAL_HOME) process.env.HOME = ORIGINAL_HOME;
});

afterEach(() => {
  if (ORIGINAL_HOME) process.env.HOME = ORIGINAL_HOME;
  else delete process.env.HOME;
});

describe("configDir()", () => {
  it("returns a path under the CURRENT process.env.HOME, not a cached value", () => {
    const homeA = mkdtempSync(join(tmpdir(), "ano-cli-home-a-"));
    const homeB = mkdtempSync(join(tmpdir(), "ano-cli-home-b-"));

    process.env.HOME = homeA;
    const a = configDir();
    expect(a).toBe(join(homeA, ".config", "ano"));

    process.env.HOME = homeB;
    const b = configDir();
    expect(b).toBe(join(homeB, ".config", "ano"));

    rmSync(homeA, { recursive: true, force: true });
    rmSync(homeB, { recursive: true, force: true });
  });
});

describe("loadGlobalCredentials() respects current HOME", () => {
  it("reads from the redirected HOME, not the daemon's startup HOME", () => {
    // Simulate the in-app PTY scenario: daemon was started with one
    // HOME, but request comes in from a process whose HOME is
    // redirected to a different path with its own credentials.json.
    const daemonHome = mkdtempSync(join(tmpdir(), "ano-cli-daemon-"));
    const ptyHome = mkdtempSync(join(tmpdir(), "ano-cli-pty-"));

    // Plant different creds in each HOME.
    process.env.HOME = daemonHome;
    saveGlobalCredentials({
      profiles: {
        default: {
          key: "DAEMON-KEY",
          endpoint: "https://api-staging.ano.dev",
          created_at: "2026-01-01",
        },
      },
    });

    process.env.HOME = ptyHome;
    saveGlobalCredentials({
      profiles: {
        default: {
          key: "PTY-KEY",
          endpoint: "http://127.0.0.1:3001",
          created_at: "2026-01-01",
        },
      },
    });

    // Pre-fix (cached CONFIG_DIR), this would always read DAEMON-KEY
    // because the module captured `homedir()` at first import. Post-
    // fix, each call recomputes from process.env.HOME.
    process.env.HOME = daemonHome;
    expect(loadGlobalCredentials()?.profiles.default.key).toBe("DAEMON-KEY");

    process.env.HOME = ptyHome;
    expect(loadGlobalCredentials()?.profiles.default.key).toBe("PTY-KEY");

    // Switch back — must reflect immediately.
    process.env.HOME = daemonHome;
    expect(loadGlobalCredentials()?.profiles.default.key).toBe("DAEMON-KEY");

    rmSync(daemonHome, { recursive: true, force: true });
    rmSync(ptyHome, { recursive: true, force: true });
  });

  it("returns null when the resolved HOME has no credentials.json", () => {
    const empty = mkdtempSync(join(tmpdir(), "ano-cli-empty-"));
    mkdirSync(join(empty, ".config", "ano"), { recursive: true });
    process.env.HOME = empty;
    expect(loadGlobalCredentials()).toBeNull();
    rmSync(empty, { recursive: true, force: true });
  });
});
