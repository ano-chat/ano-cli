import { fetch as undiciFetch } from "undici";
import { sharedHttpAgent } from "../core/http-agent.js";
import {
  cacheGet,
  cacheInvalidateOrigin,
  cacheSet,
} from "../core/response-cache.js";

/**
 * Indirection point for tests. Production code always uses undici's
 * fetch (must, because the keepalive Agent is from npm undici v8 and
 * incompatible with Node's internal undici behind globalThis.fetch).
 * Tests swap this for a vi.fn() via `_setFetchImplForTests` so they
 * can assert call counts and return canned responses without standing
 * up a real network — vitest's ESM module isolation blocks the more
 * obvious vi.spyOn(undici, "fetch") path.
 */
type FetchLike = (
  url: string,
  init?: Parameters<typeof undiciFetch>[1],
) => Promise<Response>;
let fetchImpl: FetchLike = undiciFetch as unknown as FetchLike;

/** TEST-ONLY. Replace the fetch implementation. Restore with the same call passing the original. */
export function _setFetchImplForTests(f: FetchLike): void {
  fetchImpl = f;
}
export const _originalFetchImpl: FetchLike =
  undiciFetch as unknown as FetchLike;

/**
 * Retry-aware fetch.
 *
 * Defaults are tuned for one-shot CLI calls — fail fast, surface clear
 * errors. The bridge (long-running connector for external coworkers)
 * opts back into the historical generous retry budget via options.
 *
 * Behaviour:
 *   • 429 → by default, return the response unmodified so the caller
 *     can throw a `RateLimitError` and exit with code 5 (per the
 *     SKILL.md contract). Pass `retryRateLimit: true` to retry with
 *     `Retry-After`-aware backoff (used by the bridge).
 *   • 5xx (502/503/504) → retry up to `maxRetries`, exponential backoff.
 *   • 500 → cap retries at 2 (application errors aren't usually
 *     transient — surface them fast).
 *   • Network errors (ECONNREFUSED / ETIMEDOUT / etc.) → retry up to
 *     `maxRetries`. Default `maxRetries = 2` so a stuck connection
 *     doesn't add ~30 s to a CLI command.
 *   • Other 4xx → throw `PermanentError` immediately. No retry.
 */

export class PermanentError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "PermanentError";
  }
}

export type RetryOptions = {
  /** Total retry attempts after the first try. Default: 2. */
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /**
   * Retry on HTTP 429 (Rate Limited) responses. Default `false` — the
   * CLI surfaces 429 as exit code 5 immediately so the agent can decide
   * when to back off. The bridge sets this to `true`.
   */
  retryRateLimit?: boolean;
};

/** CLI-friendly default. Bridge overrides via `{ maxRetries: 10 }`. */
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY = 1000;
const DEFAULT_MAX_DELAY = 30_000;

function jitter(): number {
  return Math.floor(Math.random() * 500);
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

export async function retryFetch(
  url: string,
  init: RequestInit,
  options?: RetryOptions,
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelay = options?.baseDelayMs ?? DEFAULT_BASE_DELAY;
  const maxDelay = options?.maxDelayMs ?? DEFAULT_MAX_DELAY;
  const retryRateLimit = options?.retryRateLimit ?? false;

  let lastError: Error | undefined;

  // Route every retry-aware fetch through the shared keepalive agent
  // so the daemon's warm process reuses TCP+TLS across dispatches.
  // Callers may still pass their own `dispatcher` to override (e.g.
  // tests stubbing the network); we only set ours if absent.
  const initWithAgent: RequestInit & { dispatcher?: unknown } = {
    ...init,
    dispatcher:
      (init as { dispatcher?: unknown }).dispatcher ?? sharedHttpAgent,
  };

  // Cache layer: allowlisted /mcp/list_* style reads may be served
  // from a 5s TTL in-process cache. Anything not in the read allowlist
  // invalidates the origin's cache (post-mutation reads should always
  // be fresh). See src/core/response-cache.ts for the design.
  const bodyJson = typeof init.body === "string" ? init.body : "";
  const authHeader = extractAuthHeader(init.headers);
  const cached = cacheGet(url, authHeader, bodyJson);
  if (cached) {
    return new Response(cached.body, {
      status: cached.status,
      headers: cached.headers,
    });
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      // Use undici's own fetch — globalThis.fetch in Node binds to
      // Node's internal (older) undici, which is incompatible with
      // the npm undici v8 `Agent` we pass via `dispatcher` (interceptor
      // protocol changed). Mixing them throws `UND_ERR_INVALID_ARG:
      // invalid onRequestStart method`. Pinning both fetch and Agent
      // to the same npm undici package fixes it.
      res = await fetchImpl(
        url,
        initWithAgent as Parameters<typeof undiciFetch>[1],
      );
    } catch (err) {
      // Network error (ECONNREFUSED, ETIMEDOUT, etc.)
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = Math.min(baseDelay * 2 ** attempt, maxDelay) + jitter();
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw lastError;
    }

    if (res.ok) {
      // Branch on cacheability. Reads in the allowlist: clone the
      // body so we can both store it and return a working Response
      // to the caller (Response bodies are single-use). Writes:
      // invalidate the origin's cache so the next read after the
      // mutation re-fetches fresh.
      const isRead = isAllowedRead(url);
      if (isRead) {
        const text = await res.text();
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          headers[k] = v;
        });
        cacheSet(url, authHeader, bodyJson, {
          status: res.status,
          headers,
          body: text,
        });
        return new Response(text, { status: res.status, headers });
      }
      // Write path — clear cache for this origin.
      cacheInvalidateOrigin(url);
      return res;
    }

    if (res.status === 429) {
      // Default: return the 429 response so the caller throws a
      // RateLimitError and exits with code 5. No silent waiting.
      if (!retryRateLimit) return res;

      // Long-running consumer (bridge) — respect Retry-After + backoff.
      await res.body?.cancel().catch(() => {});
      const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
      const delay =
        retryAfter ?? Math.min(baseDelay * 2 ** attempt, maxDelay) + jitter();
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new Error(`429 Too Many Requests after ${maxRetries} retries`);
    }

    if (res.status >= 500) {
      // Distinguish transient gateway errors from application errors:
      //   • 502 / 503 / 504 — proxy/upstream-down/timeout — retry up to
      //     `maxRetries` (full exponential backoff, ~maxDelay ceiling).
      //   • 500 — application error from the server's catch-all. These
      //     are usually NOT transient (a SQL bug, a thrown exception in
      //     a handler). Cap at 2 quick retries (~3 s) so users surface
      //     the failure fast instead of waiting through the full budget.
      await res.body?.cancel().catch(() => {});
      lastError = new Error(`Server error: ${res.status}`);
      const isApplicationError = res.status === 500;
      const effectiveMaxRetries = isApplicationError
        ? Math.min(maxRetries, 2)
        : maxRetries;
      if (attempt < effectiveMaxRetries) {
        const delay = Math.min(baseDelay * 2 ** attempt, maxDelay) + jitter();
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw lastError;
    }

    // 4xx (not 429) — permanent error
    const body = await res.text().catch(() => "");
    throw new PermanentError(res.status, `${res.status}: ${body}`);
  }

  throw lastError ?? new Error("retryFetch: unexpected end");
}

/** Extract the Authorization header value from RequestInit headers. */
function extractAuthHeader(
  headers: HeadersInit | undefined,
): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers)
    return headers.get("Authorization") ?? undefined;
  if (Array.isArray(headers)) {
    for (const [k, v] of headers) {
      if (k.toLowerCase() === "authorization") return v;
    }
    return undefined;
  }
  // Plain object — case-insensitive lookup.
  for (const [k, v] of Object.entries(headers as Record<string, string>)) {
    if (k.toLowerCase() === "authorization") return v;
  }
  return undefined;
}

/**
 * Quick check: does this URL fall in the cache's read allowlist? The
 * `response-cache` module also checks before storing, but doing it
 * here avoids paying for `res.text()` on the write path.
 */
function isAllowedRead(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.pathname.startsWith("/mcp/")) return false;
    const sub = u.pathname.substring(4); // strip /mcp prefix
    return ALLOWED_READS.has(sub);
  } catch {
    return false;
  }
}

// Mirror src/core/response-cache.ts READ_ALLOWLIST — keep in sync.
// Duplicated here so retry.ts can decide whether to drain `res.text()`
// (only done on cacheable reads) without importing the cache's
// internal set.
const ALLOWED_READS = new Set<string>([
  "/list_workspaces",
  "/list_channels",
  "/list_users",
  "/list_tables",
  "/get_table",
]);
