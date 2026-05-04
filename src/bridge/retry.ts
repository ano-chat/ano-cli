/**
 * Retry-aware fetch with exponential backoff.
 *
 * - 5xx / network errors → retry
 * - 429 → respect Retry-After header, then retry
 * - 4xx (except 429) → throw PermanentError (no retry)
 * - Max retries exhausted → throw last error
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
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

const DEFAULT_MAX_RETRIES = 10;
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
      // Rate limited — respect Retry-After, consume body to free connection
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
      //     `maxRetries` (full exponential backoff, ~60s ceiling).
      //   • 500 — application error from the server's catch-all. These
      //     are usually NOT transient (a SQL bug, a thrown exception in
      //     a handler). Cap at 2 quick retries (~3s) so users surface
      //     the failure fast instead of waiting through 10 attempts.
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
