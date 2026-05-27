/**
 * Derive the Zero sync (`cacheURL`) origin from the user's resolved
 * regional API endpoint.
 *
 * The desktop computes this from `home_region` ("us" | "eu") into
 * `sync-us.ano.dev` / `sync-eu.ano.dev`. The CLI doesn't carry
 * `home_region` separately — it carries the resolved regional API
 * endpoint per profile (set at `ano auth login` time). The mapping
 * is mechanical:
 *
 *   https://api-us.ano.dev       → https://sync-us.ano.dev
 *   https://api-eu.ano.dev       → https://sync-eu.ano.dev
 *   https://api-staging.ano.dev  → https://sync-staging.ano.dev
 *   http://127.0.0.1:3001        → http://127.0.0.1:4848  (dev:local)
 *   http://localhost:3001        → http://localhost:4848  (dev:local)
 *
 * Returns null for unrecognized endpoints (e.g. the apex
 * `https://api.ano.dev` which the CLI shouldn't be using directly —
 * it should have resolved to a regional endpoint at login). Callers
 * fall back to REST in that case.
 */
export function deriveCacheUrl(endpoint: string): string | null {
  const normalized = endpoint.replace(/\/+$/, "");
  try {
    const u = new URL(normalized);
    // Local dev: api on :3001 → zero-cache on :4848 (matches monorepo
    // `npm run dev:local` defaults).
    if (
      (u.hostname === "127.0.0.1" || u.hostname === "localhost") &&
      u.port === "3001"
    ) {
      return `${u.protocol}//${u.hostname}:4848`;
    }
    // Hosted: api-<env>.ano.dev → sync-<env>.ano.dev
    if (u.hostname.endsWith(".ano.dev") && u.hostname.startsWith("api-")) {
      const env = u.hostname.slice("api-".length, -".ano.dev".length);
      if (env.length > 0) {
        return `${u.protocol}//sync-${env}.ano.dev`;
      }
    }
    // Apex `api.ano.dev` is the Worker — sync isn't routed through it.
    // Callers using the apex haven't resolved a region; they should
    // re-login or pass a regional endpoint.
    return null;
  } catch {
    return null;
  }
}
