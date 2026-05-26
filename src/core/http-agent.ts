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
 * - allowH2: true — opt into HTTP/2 when the server's ALPN negotiates
 *   it. Ano's regional API (api-us / api-eu) and staging all serve
 *   H2 (verified via `curl -I`). Falls back to HTTP/1.1 transparently
 *   when the server doesn't support it (localhost dev server, tests).
 *
 *   Caveat: with `connections: 32` the agent is free to open multiple
 *   parallel connections even when H2 multiplexing would let one
 *   suffice. Forcing single-connection multiplexing would require
 *   `connections: 1`, which would hurt H1-fallback workloads (the
 *   one connection becomes a bottleneck). Since the daemon dispatches
 *   commands serially, the practical benefit of H2 here is small —
 *   the keepalive socket reuse already covers sequential calls. We
 *   set the flag because it's free when the server speaks H2 and
 *   future-proofs us against any concurrent dispatch path that lands
 *   later (e.g., a parallel `ano workspaces sync` doing many reads).
 */
export const sharedHttpAgent = new Agent({
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
  connections: 32,
  pipelining: 1,
  allowH2: true,
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
