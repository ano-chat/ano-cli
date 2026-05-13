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

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
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

    if (res.ok) return res;

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
