/**
 * Resolve the web app base URL for the current environment — the origin
 * deep-links (e.g. the unread-triage "jump to message" URL) are built
 * against. Server is the source of truth (`webAppUrl` on the public
 * `/api/min-version` response); deriving from the API endpoint is the
 * offline fallback (older server, unreachable network).
 */

/**
 * Derive the web app URL from the API endpoint using the established
 * `api`↔`app` naming convention. Pure, no network — the fallback when
 * the server doesn't supply `webAppUrl`.
 *
 *   http://localhost:3001        → http://localhost:1420  (Vite web)
 *   http://127.0.0.1:3001        → http://localhost:1420
 *   https://api.ano.dev          → https://app.ano.dev
 *   https://api-staging.ano.dev  → https://app-staging.ano.dev
 *   anything else                → the endpoint's own origin
 */
export function deriveWebAppUrl(endpoint: string): string {
  try {
    const u = new URL(endpoint);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
      return "http://localhost:1420";
    }
    if (u.hostname.startsWith("api")) {
      return `${u.protocol}//${u.hostname.replace(/^api/, "app")}`;
    }
    return u.origin;
  } catch {
    return "http://localhost:1420";
  }
}

/**
 * Fetch the server-authoritative `webAppUrl` from `/api/min-version`
 * (public, no auth). Falls back to {@link deriveWebAppUrl} on any
 * failure — non-OK status, missing/empty field, parse error, timeout,
 * or network error — so callers always get a usable base.
 *
 * `fetchImpl` is injectable for tests; defaults to the global fetch.
 */
export async function resolveWebAppUrl(
  endpoint: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const base = endpoint.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetchImpl(`${base}/api/min-version`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as {
        webAppUrl?: unknown;
      } | null;
      if (typeof body?.webAppUrl === "string" && body.webAppUrl.trim()) {
        const candidate = body.webAppUrl.trim().replace(/\/+$/, "");
        // Defense-in-depth: this value is embedded in a clickable
        // "jump to message" link the user is primed to click. Do NOT
        // trust an arbitrary origin from the response — a tampered or
        // compromised /api/min-version could otherwise turn the link
        // into a phishing redirect. Accept only an Ano web origin
        // (https *.ano.dev) or localhost; otherwise derive from the
        // endpoint the user already chose to trust.
        if (isTrustedWebAppUrl(candidate)) return candidate;
      }
    }
  } catch {
    // fall through to derive
  } finally {
    clearTimeout(timer);
  }
  return deriveWebAppUrl(endpoint);
}

/**
 * Whether a web app URL is safe to embed in a user-facing clickable
 * deep-link. Mirrors the desktop shell interceptor's `isAnoWebOrigin`
 * trust rule so both sides agree on what counts as "ours":
 *   - https `*.ano.dev` (app.ano.dev / app-staging.ano.dev), or
 *   - localhost / 127.0.0.1 (dev, any scheme).
 * NOTE: hardcodes the ano.dev domain — revisit if white-label /
 * self-hosted deployments land (would need to bind to the endpoint's
 * registrable domain instead).
 */
function isTrustedWebAppUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
  return u.protocol === "https:" && u.hostname.endsWith(".ano.dev");
}
