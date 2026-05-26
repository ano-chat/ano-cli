/**
 * Shared undici Agent for outbound HTTP. Two reasons it exists:
 *
 *   1. **Keepalive across dispatches.** When the daemon serves many
 *      `ano <cmd>` invocations from one warm Node process, every
 *      command's `fetch()` would otherwise pay a fresh TCP + TLS
 *      handshake against the Ano API server. With this agent's
 *      `keepAliveTimeout`, the first call establishes the connection
 *      and subsequent calls reuse it — saving ~50–100 ms staging,
 *      ~200–300 ms prod-regional (transatlantic to Hetzner).
 *
 *   2. **Per-origin pool ceiling.** `connections: 32` is plenty for a
 *      CLI; it prevents pathological fan-out from a runaway loop while
 *      still letting concurrent agent dispatches share the pool.
 *
 * Fork-mode CLI calls (no daemon) only ever make 1 request before the
 * process dies, so keepalive is a no-op there. It's only material in
 * daemon mode. The unified code path is harmless either way.
 *
 * Why a module-level singleton: undici's connection cache is keyed by
 * Agent instance, so re-creating the Agent per request would defeat
 * the purpose. Importing this module multiple times still yields one
 * Agent (ESM module identity).
 *
 * Pre-warm: `prewarmConnection(origin)` opens a single HEAD request to
 * the given origin so the first real call doesn't pay TLS setup. Used
 * by daemon serve startup.
 */
import { Agent, fetch as undiciFetch } from "undici";

/**
 * Tuned for warm-daemon CLI usage.
 *
 * - keepAliveTimeout: Node default is ~4s; bumped to 60s so a daemon
 *   that handles bursty agent traffic (a few calls, pause, more calls)
 *   doesn't tear down the socket between bursts.
 * - keepAliveMaxTimeout: hard ceiling so a server-side keepalive bug
 *   can't pin a socket forever.
 * - connections: per-origin cap. 32 is plenty for a CLI; a runaway
 *   loop can't blow the FD table.
 * - pipelining: 1 (undici default) — one request at a time per
 *   connection, but the connection IS reused across sequential requests.
 *   Crucially, `pipelining: 0` in undici **disables keep-alive entirely**
 *   (the option name is misleading; it's not "no pipelining, just
 *   reuse" — it's "no reuse at all"). Verified by `tests/scripts/
 *   keepalive-bench.mjs`: pipelining=0 opens N sockets for N calls;
 *   pipelining=1 opens 1 socket and reuses.
 */
export const sharedHttpAgent = new Agent({
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
  connections: 32,
  pipelining: 1,
});

/**
 * Pre-establish a TCP + TLS connection to `origin` so the first real
 * request from the daemon doesn't pay handshake latency. Best effort —
 * any failure is swallowed (the real request will retry from scratch).
 *
 * `origin` is a URL string; only the scheme + host + port matter. The
 * pathname is forced to `/` so we don't accidentally probe a real
 * endpoint that might mutate state.
 */
export async function prewarmConnection(origin: string): Promise<void> {
  try {
    const url = new URL("/", origin);
    const controller = new AbortController();
    // Short deadline — if the network is broken we don't want to hold
    // up daemon startup. The real first call will try again with its
    // own timeout.
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      // HEAD / is the cheapest valid request. Some origins 404 it, but
      // 404 still completes the TLS handshake — that's all we need.
      await undiciFetch(url.toString(), {
        method: "HEAD",
        signal: controller.signal,
        // Force the request through the shared agent so the socket
        // ends up in the keepalive pool keyed correctly. Must use
        // undici's own `fetch` — globalThis.fetch in Node binds to
        // Node's internal undici, which is incompatible with the
        // npm undici v8 Agent we pass (see retry.ts comment).
        dispatcher: sharedHttpAgent,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Best effort.
  }
}
