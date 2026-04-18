import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import {
  DEFAULT_OAUTH_PORT,
  OAUTH_CALLBACK_PATH,
  runOAuthLogin,
} from "../../src/core/oauth-flow.js";

const FAKE_CLIENT_ID = "client_testabc";
const FAKE_ENDPOINT = "https://api-staging.ano.dev";

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

describe("runOAuthLogin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports sensible defaults", () => {
    expect(DEFAULT_OAUTH_PORT).toBe(41729);
    expect(OAUTH_CALLBACK_PATH).toBe("/cli-callback");
  });

  it("constructs the authorize URL with the expected params and triggers callback", async () => {
    const port = await freePort();
    let authorizeUrl: string | null = null;

    const runPromise = runOAuthLogin({
      endpoint: FAKE_ENDPOINT,
      clientId: FAKE_CLIENT_ID,
      port,
      timeoutMs: 2000,
      openBrowser: () => {},
      onAuthorizeUrl: (url) => {
        authorizeUrl = url;
      },
    }).catch((e) => e);

    // Wait for the listener to be up + onAuthorizeUrl to fire.
    await waitFor(() => authorizeUrl !== null, 1000);
    const parsed = new URL(authorizeUrl!);
    expect(parsed.origin + parsed.pathname).toBe(
      `${FAKE_ENDPOINT}/user_management/authorize`,
    );
    expect(parsed.searchParams.get("client_id")).toBe(FAKE_CLIENT_ID);
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      `http://localhost:${port}${OAUTH_CALLBACK_PATH}`,
    );
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("provider")).toBe("authkit");
    expect(parsed.searchParams.get("state")).toMatch(/^[0-9a-f]{48}$/);

    // Let the promise reject via timeout so the server cleans up.
    const result = await runPromise;
    expect(result).toBeInstanceOf(Error);
  });

  it("rejects when state param doesn't match (CSRF guard)", async () => {
    const port = await freePort();
    let authorizeUrl: string | null = null;

    const runPromise = runOAuthLogin({
      endpoint: FAKE_ENDPOINT,
      clientId: FAKE_CLIENT_ID,
      port,
      timeoutMs: 5000,
      openBrowser: () => {},
      onAuthorizeUrl: (url) => {
        authorizeUrl = url;
      },
    });
    runPromise.catch(() => {}); // mark handled so the later hit doesn't race

    await waitFor(() => authorizeUrl !== null, 1000);
    // Hit the callback with a WRONG state
    await fetch(
      `http://localhost:${port}${OAUTH_CALLBACK_PATH}?code=abc&state=wrong-state`,
    ).catch(() => undefined);

    await expect(runPromise).rejects.toThrow(/state mismatch/i);
  });

  it("rejects when callback carries an error param", async () => {
    const port = await freePort();
    let authorizeUrl: string | null = null;

    const runPromise = runOAuthLogin({
      endpoint: FAKE_ENDPOINT,
      clientId: FAKE_CLIENT_ID,
      port,
      timeoutMs: 5000,
      openBrowser: () => {},
      onAuthorizeUrl: (url) => {
        authorizeUrl = url;
      },
    });
    runPromise.catch(() => {});

    await waitFor(() => authorizeUrl !== null, 1000);
    await fetch(
      `http://localhost:${port}${OAUTH_CALLBACK_PATH}?error=access_denied&error_description=User+cancelled`,
    ).catch(() => undefined);

    await expect(runPromise).rejects.toThrow(/User cancelled|access_denied/);
  });

  it("rejects with a clear error when the port is already in use", async () => {
    const port = await freePort();
    const blocker = createServer();
    await new Promise<void>((resolve) =>
      blocker.listen(port, "127.0.0.1", resolve),
    );

    try {
      await expect(
        runOAuthLogin({
          endpoint: FAKE_ENDPOINT,
          clientId: FAKE_CLIENT_ID,
          port,
          timeoutMs: 1000,
          openBrowser: () => {},
        }),
      ).rejects.toThrow(/port .* is in use/i);
    } finally {
      await closeServer(blocker);
    }
  });
});

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timeout");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}
