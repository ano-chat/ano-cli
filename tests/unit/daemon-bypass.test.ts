/**
 * Tests for the `shouldBypass` decision in the daemon client.
 *
 * Bypass means the shim runs the command in-process today (no daemon
 * round-trip). Wrong rules either silently break commands (if we route
 * to the daemon when we shouldn't) or quietly disable the speedup (if
 * we bypass when we shouldn't), so this is the highest-leverage place
 * to lock down behaviour.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldBypass } from "../../src/daemon/client.js";

const ORIG_ENV = { ...process.env };

afterEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, ORIG_ENV);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shouldBypass", () => {
  it("bypasses when ANO_NO_DAEMON=1 is set", () => {
    process.env.ANO_NO_DAEMON = "1";
    expect(shouldBypass(["channels", "list", "--agent"])).toBe(true);
  });

  it("bypasses when ANO_NO_DAEMON=true is set", () => {
    process.env.ANO_NO_DAEMON = "true";
    expect(shouldBypass(["messages", "send", "hi", "-c", "x"])).toBe(true);
  });

  it("bypasses when argv is empty (bare `ano` shows help)", () => {
    delete process.env.ANO_NO_DAEMON;
    expect(shouldBypass([])).toBe(true);
  });

  it("bypasses the `daemon` command itself", () => {
    delete process.env.ANO_NO_DAEMON;
    expect(shouldBypass(["daemon", "start"])).toBe(true);
    expect(shouldBypass(["daemon", "stop"])).toBe(true);
    expect(shouldBypass(["daemon", "status"])).toBe(true);
  });

  it("bypasses `dev` so smoke can read profile/env + probe daemon state", () => {
    delete process.env.ANO_NO_DAEMON;
    expect(shouldBypass(["dev", "smoke"])).toBe(true);
    expect(shouldBypass(["dev", "smoke", "--agent"])).toBe(true);
  });

  it("bypasses interactive auth flows", () => {
    delete process.env.ANO_NO_DAEMON;
    expect(shouldBypass(["auth", "login"])).toBe(true);
    expect(shouldBypass(["auth", "complete"])).toBe(true);
    expect(shouldBypass(["auth", "refresh-region"])).toBe(true);
    expect(shouldBypass(["auth", "logout"])).toBe(true);
  });

  it("does NOT bypass non-interactive auth subcommands", () => {
    delete process.env.ANO_NO_DAEMON;
    expect(shouldBypass(["auth", "status", "--agent"])).toBe(false);
  });

  it("bypasses commands reading stdin via --file -", () => {
    delete process.env.ANO_NO_DAEMON;
    expect(
      shouldBypass(["automation", "create-compiled", "--file", "-", "--agent"]),
    ).toBe(true);
    expect(
      shouldBypass(["automation", "create-compiled", "-f", "-", "--agent"]),
    ).toBe(true);
    expect(shouldBypass(["automation", "compile", "--file=-"])).toBe(true);
  });

  it("does NOT bypass --file with a real path", () => {
    delete process.env.ANO_NO_DAEMON;
    expect(
      shouldBypass([
        "automation",
        "create-compiled",
        "--file",
        "plan.json",
        "--agent",
      ]),
    ).toBe(false);
  });

  it("does NOT bypass standard read/write commands", () => {
    delete process.env.ANO_NO_DAEMON;
    expect(shouldBypass(["channels", "list", "--agent"])).toBe(false);
    expect(
      shouldBypass([
        "messages",
        "send",
        "hi",
        "--channel-name",
        "engineering",
        "--agent",
      ]),
    ).toBe(false);
    expect(shouldBypass(["dm", "send", "hi", "--to", "Leo", "--agent"])).toBe(
      false,
    );
    expect(shouldBypass(["users", "list", "--agent"])).toBe(false);
  });

  it("ignores leading flags when finding the top-level command", () => {
    delete process.env.ANO_NO_DAEMON;
    expect(shouldBypass(["--debug", "channels", "list"])).toBe(false);
    expect(shouldBypass(["--debug", "daemon", "status"])).toBe(true);
  });

  it("treats unrecognised top-level commands as eligible (daemon will error normally)", () => {
    delete process.env.ANO_NO_DAEMON;
    expect(shouldBypass(["nonsense", "foo"])).toBe(false);
  });

  it("bypasses on win32 (Unix-socket assumptions don't hold)", () => {
    delete process.env.ANO_NO_DAEMON;
    const spy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    expect(shouldBypass(["channels", "list", "--agent"])).toBe(true);
    spy.mockRestore();
  });

  it("bypasses `--agent --help` so the structured-JSON help handler runs", () => {
    delete process.env.ANO_NO_DAEMON;
    // src/index.ts intercepts this combo BEFORE commander; daemon
    // dispatch would skip the interception and emit textual help.
    expect(shouldBypass(["channels", "list", "--agent", "--help"])).toBe(true);
    expect(shouldBypass(["--agent", "--help"])).toBe(true);
    expect(shouldBypass(["channels", "--help", "--agent"])).toBe(true);
  });

  it("does NOT bypass plain --help (commander handles it the same in either path)", () => {
    delete process.env.ANO_NO_DAEMON;
    expect(shouldBypass(["channels", "list", "--help"])).toBe(false);
  });
});
