// CLI port of the desktop's `region-resolver.ts` + iOS RouteResolver. The
// CLI variant is sync-cache-free: the resolved regional `apiUrl` is
// persisted into the credentials file at `ano auth login` time, so every
// subsequent invocation reads it from disk (`profile.endpoint`) with no
// extra HTTP round-trip. The only callers are auth flows.
//
// The Worker's `/route` endpoint lives ONLY on `api.ano.dev` — the
// regional origins (`api-us`, `api-eu`) return 404 for `/route` because
// the Worker is mounted at the apex hostname. So we never call this
// helper when the caller already has a regional endpoint.

export type Region = "us" | "eu";
export type ResolutionSource = "kv" | "cf-ipcountry" | "default";

export interface RouteResponse {
  region: Region;
  apiUrl: string;
  source: ResolutionSource;
}

export interface ResolveRouteOptions {
  endpoint: string;
  workspaceId?: string;
  fetchImpl?: typeof fetch;
  /** Soft timeout in ms; defaults to 3000. */
  timeoutMs?: number;
}

/**
 * Hit the Worker's `/route` endpoint and return the resolved regional
 * `apiUrl`. Returns `null` on any failure (timeout, non-200, bad JSON,
 * mismatched shape) — callers fall back to the configured endpoint,
 * which still works (CF Worker geo-routes anyway, just not optimally).
 */
export async function resolveRoute(
  opts: ResolveRouteOptions,
): Promise<RouteResponse | null> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 3000;

  const base = opts.endpoint.endsWith("/")
    ? opts.endpoint
    : `${opts.endpoint}/`;
  const url = new URL("route", base);
  if (opts.workspaceId) {
    url.searchParams.set("workspace_id", opts.workspaceId);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Pass a string (not the URL object) so the rest of the codebase's
    // string-based fetch mocks see a consistent call shape.
    const res = await fetchImpl(url.toString(), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<RouteResponse>;
    if (
      (body.region !== "us" && body.region !== "eu") ||
      typeof body.apiUrl !== "string" ||
      typeof body.source !== "string"
    ) {
      return null;
    }
    return {
      region: body.region,
      apiUrl: body.apiUrl.endsWith("/")
        ? body.apiUrl.slice(0, -1)
        : body.apiUrl,
      source: body.source as ResolutionSource,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * True when `/route` resolution is meaningful for the caller's endpoint.
 * `api.ano.dev` is the CF Worker origin where the Worker is mounted;
 * regional and staging endpoints don't have `/route`.
 */
export function shouldResolveRoute(endpoint: string): boolean {
  const normalized = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
  return normalized === "https://api.ano.dev";
}
