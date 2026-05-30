/**
 * Tests for the daemon wire protocol primitives.
 *
 * These pin down:
 *   • `frame()` always emits a single newline-terminated JSON line
 *     (the server's parser uses `\n` as the only delimiter).
 *   • `defaultSocketPath()` honours the env-var override, prefers
 *     XDG_RUNTIME_DIR on Linux when present, and otherwise lands in a
 *     stable home-anchored path. Wrong path = client + server can't find
 *     each other. CRITICALLY, the fallback must be invariant under
 *     `$TMPDIR` — that invariance is the whole reason one warm daemon can
 *     be shared across a shell, an agent (Claude Code sets
 *     `TMPDIR=/tmp/claude-<uid>`), ssh, and cron.
 *   • `resolveIdleMs()` honours `ANO_DAEMON_IDLE_MS` (0 = never exit).
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { homedir } from "node:os";
import {
  DEFAULT_IDLE_MS,
  defaultSocketPath,
  frame,
  resolveIdleMs,
} from "../../src/daemon/protocol.js";

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, ORIG_ENV);
});

afterEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, ORIG_ENV);
});

describe("frame", () => {
  it("ends in exactly one newline", () => {
    expect(frame({ a: 1 })).toBe('{"a":1}\n');
  });

  it("serialises arrays and nested objects", () => {
    expect(frame({ x: [1, 2], y: { z: "ok" } })).toBe(
      '{"x":[1,2],"y":{"z":"ok"}}\n',
    );
  });

  it("never produces multiple lines for embedded newlines", () => {
    const f = frame({ msg: "line1\nline2" });
    expect(f.split("\n")).toHaveLength(2); // payload + trailing \n
    expect(f.endsWith("\n")).toBe(true);
  });
});

describe("defaultSocketPath", () => {
  it("honours ANO_DAEMON_SOCKET when set", () => {
    process.env.ANO_DAEMON_SOCKET = "/custom/path.sock";
    expect(defaultSocketPath()).toBe("/custom/path.sock");
  });

  it("uses XDG_RUNTIME_DIR when set and no override", () => {
    delete process.env.ANO_DAEMON_SOCKET;
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    expect(defaultSocketPath()).toBe("/run/user/1000/ano-daemon.sock");
  });

  it("falls back to a stable ~/.cache/ano/daemon-<uid>.sock path", () => {
    delete process.env.ANO_DAEMON_SOCKET;
    delete process.env.XDG_RUNTIME_DIR;
    const path = defaultSocketPath();
    expect(path.startsWith(homedir())).toBe(true);
    expect(path).toMatch(/\.cache[\\/]ano[\\/]daemon-\d+\.sock$/);
  });

  it("env override wins over XDG_RUNTIME_DIR", () => {
    process.env.ANO_DAEMON_SOCKET = "/x/y.sock";
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    expect(defaultSocketPath()).toBe("/x/y.sock");
  });

  // Regression: the fallback socket MUST NOT depend on $TMPDIR. Before this
  // was fixed it used os.tmpdir(), so Claude Code / ssh / cron each got a
  // different socket and spawned their own daemon instead of sharing one warm
  // replica — the root cause of "the CLI feels cold everywhere".
  it("is invariant under $TMPDIR (no daemon fragmentation)", () => {
    delete process.env.ANO_DAEMON_SOCKET;
    delete process.env.XDG_RUNTIME_DIR;

    process.env.TMPDIR = "/tmp/claude-502";
    const underClaude = defaultSocketPath();

    process.env.TMPDIR = "/var/folders/zz/abc/T/";
    const underLoginSession = defaultSocketPath();

    delete process.env.TMPDIR;
    const underNoTmpdir = defaultSocketPath();

    expect(underClaude).toBe(underLoginSession);
    expect(underClaude).toBe(underNoTmpdir);
  });

  // XDG_RUNTIME_DIR is the one acceptable non-home location (Linux): it is
  // stable per-user and not a $TMPDIR alias.
  it("XDG_RUNTIME_DIR result is also $TMPDIR-invariant", () => {
    delete process.env.ANO_DAEMON_SOCKET;
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    process.env.TMPDIR = "/tmp/whatever";
    expect(defaultSocketPath()).toBe("/run/user/1000/ano-daemon.sock");
  });
});

describe("resolveIdleMs", () => {
  it("returns DEFAULT_IDLE_MS when unset", () => {
    delete process.env.ANO_DAEMON_IDLE_MS;
    expect(resolveIdleMs()).toBe(DEFAULT_IDLE_MS);
  });

  it("returns DEFAULT_IDLE_MS for an empty / whitespace value", () => {
    process.env.ANO_DAEMON_IDLE_MS = "   ";
    expect(resolveIdleMs()).toBe(DEFAULT_IDLE_MS);
  });

  it("returns 0 (never exit) when explicitly set to 0", () => {
    process.env.ANO_DAEMON_IDLE_MS = "0";
    expect(resolveIdleMs()).toBe(0);
  });

  it("passes through a valid positive value", () => {
    process.env.ANO_DAEMON_IDLE_MS = "5000";
    expect(resolveIdleMs()).toBe(5000);
  });

  it("falls back to default for negative or non-numeric input", () => {
    process.env.ANO_DAEMON_IDLE_MS = "-1";
    expect(resolveIdleMs()).toBe(DEFAULT_IDLE_MS);
    process.env.ANO_DAEMON_IDLE_MS = "not-a-number";
    expect(resolveIdleMs()).toBe(DEFAULT_IDLE_MS);
  });

  it("defaults to 60 minutes", () => {
    expect(DEFAULT_IDLE_MS).toBe(60 * 60 * 1000);
  });
});
