import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

export interface OAuthResult {
  accessToken: string;
  refreshToken?: string;
  user?: {
    id?: string;
    email?: string;
    first_name?: string;
    last_name?: string;
  };
}

export interface OAuthOptions {
  endpoint: string;
  clientId: string;
  /**
   * Fixed loopback port. Fixed rather than ephemeral because WorkOS requires
   * each exact redirect URI (incl. port) to be allowlisted per client. Pick
   * one port, allowlist it once, done.
   */
  port?: number;
  timeoutMs?: number;
  onAuthorizeUrl?: (url: string) => void;
  /** Override the browser launcher (tests pass a no-op). */
  openBrowser?: (url: string) => void;
}

export const DEFAULT_OAUTH_PORT = 41729;
export const OAUTH_CALLBACK_PATH = "/cli-callback";

const SUCCESS_PAGE = `<!doctype html><html><head><title>Ano CLI</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fafafa}
.card{text-align:center;padding:2rem}h1{margin:0 0 .5rem;font-weight:600;font-size:1.25rem}
p{margin:0;color:#888;font-size:.875rem}</style></head><body>
<div class="card"><h1>Authentication successful</h1><p>You can close this tab and return to your terminal.</p></div>
</body></html>`;

const ERROR_PAGE = (
  msg: string,
) => `<!doctype html><html><head><title>Ano CLI — error</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fafafa}
.card{text-align:center;padding:2rem;max-width:420px}h1{margin:0 0 .5rem;font-weight:600;font-size:1.25rem;color:#ef4444}
p{margin:0;color:#888;font-size:.875rem}</style></head><body>
<div class="card"><h1>Authentication failed</h1><p>${msg}</p></div>
</body></html>`;

/**
 * Run the OAuth loopback flow. Spins up a local HTTP listener on an
 * ephemeral port, opens the WorkOS authorize URL in the user's browser
 * (via api.ano.dev's proxy), waits for the redirect, then exchanges
 * the code for an access token via /user_management/authenticate.
 */
export async function runOAuthLogin(opts: OAuthOptions): Promise<OAuthResult> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const port = opts.port ?? DEFAULT_OAUTH_PORT;
  const state = randomBytes(24).toString("hex");

  const { code, redirectUri } = await captureAuthCode({
    endpoint: opts.endpoint,
    clientId: opts.clientId,
    port,
    state,
    timeoutMs,
    onAuthorizeUrl: opts.onAuthorizeUrl,
    openBrowser: opts.openBrowser ?? defaultOpenBrowser,
  });

  return exchangeCodeForToken({
    endpoint: opts.endpoint,
    clientId: opts.clientId,
    redirectUri,
    code,
  });
}

function buildAuthorizeUrl(params: {
  endpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(
    `${stripTrailingSlash(params.endpoint)}/user_management/authorize`,
  );
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("provider", "authkit");
  url.searchParams.set("state", params.state);
  return url.toString();
}

async function captureAuthCode(opts: {
  endpoint: string;
  clientId: string;
  port: number;
  state: string;
  timeoutMs: number;
  onAuthorizeUrl?: (url: string) => void;
  openBrowser: (url: string) => void;
}): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = createServer();
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
      server.close();
    };

    const timeout = setTimeout(() => {
      finish(() =>
        reject(new Error("OAuth timed out waiting for browser callback")),
      );
    }, opts.timeoutMs);

    server.on("request", (req: IncomingMessage, res: ServerResponse) => {
      if (!req.url || !req.url.startsWith(OAUTH_CALLBACK_PATH)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      const url = new URL(req.url, "http://localhost");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");
      const code = url.searchParams.get("code");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(ERROR_PAGE(errorDescription || error));
        clearTimeout(timeout);
        finish(() =>
          reject(new Error(`OAuth error: ${errorDescription || error}`)),
        );
        return;
      }
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(ERROR_PAGE("Missing authorization code."));
        clearTimeout(timeout);
        finish(() => reject(new Error("OAuth callback missing code")));
        return;
      }
      if (returnedState !== opts.state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(ERROR_PAGE("State parameter mismatch — possible CSRF."));
        clearTimeout(timeout);
        finish(() => reject(new Error("OAuth state mismatch")));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(SUCCESS_PAGE);

      const redirectUri = `http://localhost:${opts.port}${OAUTH_CALLBACK_PATH}`;
      clearTimeout(timeout);
      finish(() => resolve({ code, redirectUri }));
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (err.code === "EADDRINUSE") {
        finish(() =>
          reject(
            new Error(
              `OAuth loopback port ${opts.port} is in use. Free the port and retry, or pass --port <n> and allowlist the new URI in WorkOS.`,
            ),
          ),
        );
        return;
      }
      finish(() => reject(err));
    });

    server.listen(opts.port, "127.0.0.1", () => {
      const redirectUri = `http://localhost:${opts.port}${OAUTH_CALLBACK_PATH}`;
      const authorizeUrl = buildAuthorizeUrl({
        endpoint: opts.endpoint,
        clientId: opts.clientId,
        redirectUri,
        state: opts.state,
      });
      if (opts.onAuthorizeUrl) {
        opts.onAuthorizeUrl(authorizeUrl);
      }
      opts.openBrowser(authorizeUrl);
    });
  });
}

async function exchangeCodeForToken(opts: {
  endpoint: string;
  clientId: string;
  redirectUri: string;
  code: string;
}): Promise<OAuthResult> {
  const url = `${stripTrailingSlash(opts.endpoint)}/user_management/authenticate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: opts.code,
      client_id: opts.clientId,
      redirect_uri: opts.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      (body &&
      typeof body === "object" &&
      ("message" in body || "error" in body)
        ? String(
            (body as Record<string, unknown>).message ??
              (body as Record<string, unknown>).error,
          )
        : `HTTP ${res.status}`) || "Authentication failed";
    throw new Error(`Token exchange failed: ${msg}`);
  }
  const payload = body as {
    access_token?: string;
    refresh_token?: string;
    user?: OAuthResult["user"];
  } | null;
  if (!payload?.access_token) {
    throw new Error(
      "Token exchange succeeded but response had no access_token",
    );
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    user: payload.user,
  };
}

function defaultOpenBrowser(url: string): void {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    } else if (platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], {
        stdio: "ignore",
        detached: true,
      }).unref();
    } else {
      spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
    }
  } catch {
    // User can still paste the URL manually — caller logs it
  }
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
