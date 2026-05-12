/**
 * Tests for the daemon wire protocol primitives.
 *
 * These pin down:
 *   • `frame()` always emits a single newline-terminated JSON line
 *     (the server's parser uses `\n` as the only delimiter).
 *   • `defaultSocketPath()` honours the env-var override, prefers
 *     XDG_RUNTIME_DIR on Linux when present, and otherwise lands in
 *     `tmpdir`. Wrong path = client + server can't find each other.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { defaultSocketPath, frame } from "../../src/daemon/protocol.js";

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

  it("falls back to tmpdir + uid when nothing is set", () => {
    delete process.env.ANO_DAEMON_SOCKET;
    delete process.env.XDG_RUNTIME_DIR;
    const path = defaultSocketPath();
    expect(path.startsWith(tmpdir())).toBe(true);
    expect(path).toMatch(/ano-daemon-\d+\.sock$/);
  });

  it("env override wins over XDG_RUNTIME_DIR", () => {
    process.env.ANO_DAEMON_SOCKET = "/x/y.sock";
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    expect(defaultSocketPath()).toBe("/x/y.sock");
  });
});
