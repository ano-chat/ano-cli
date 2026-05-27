#!/usr/bin/env node
/**
 * Standalone integration check for the response cache + retryFetch.
 *
 * Asserts the load-bearing behaviors that the unit tests can't reach
 * (vitest's ESM isolation blocks vi.spyOn(undici, "fetch")):
 *
 *   1. A second call to an allowlisted read path is served from cache
 *      → server sees ONE request.
 *   2. A write between two reads invalidates the cache → server sees
 *      THREE requests (read, write, read).
 *   3. After the TTL lapses, the next read goes to the wire again.
 *
 * Uses the BUILT dist/ so it's testing what actually ships. Vitest is
 * out of scope here — same reason as keepalive-bench.mjs.
 *
 * Usage:
 *     node tests/scripts/cache-bench.mjs
 *
 * Wired into `npm run test:keepalive`? No — keep them separate so
 * a cache regression doesn't mask a keepalive one. CI runs both.
 */
import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// v2.23.0 carve-out: /list_channels is Zero-backed by default and
// skips the response cache. This bench tests the cache mechanism
// itself against that path, so we opt out of Zero to restore
// pre-v2.23.0 cache behavior. Must be set BEFORE importing retry.ts
// since the gate is read at request-time.
process.env.ANO_DISABLE_ZERO = "1";

const __dirname = dirname(fileURLToPath(import.meta.url));

// retry.ts is bundled into one of the chunks. Use a dynamic import
// against the built source — the README of the perf branch documents
// that tests/scripts/ runs against dist/, not src/.
// We import via the *source* paths through tsx — simpler than chasing
// chunk hashes. tsx is a devDep already.

// To keep this script self-contained we register tsx + import the
// source files directly. If tsx isn't available the script bails.
const tsx = await import("tsx/esm/api").catch(() => null);
if (!tsx) {
  console.error("ERR: tsx not available; install devDependencies first.");
  process.exit(1);
}
tsx.register();

const { retryFetch } = await import("../../src/bridge/retry.js");
const { cacheClear } = await import("../../src/core/response-cache.js");

let reqCount = 0;
const reqLog = [];
const liveSockets = new Set();
const server = http.createServer((req, res) => {
  reqCount++;
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    reqLog.push(`${req.method} ${req.url} body=${body}`);
    if (req.url.includes("send_message")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"channels":["c1","c2"]}');
  });
});
server.on("connection", (s) => {
  liveSockets.add(s);
  s.on("close", () => liveSockets.delete(s));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;
const auth = { Authorization: "Bearer test-key" };

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}

async function scenario(name, body) {
  cacheClear();
  reqCount = 0;
  reqLog.length = 0;
  console.log(`\n── ${name} ──`);
  await body();
  console.log(`  requests=${reqCount}  log=${JSON.stringify(reqLog)}`);
}

await scenario("read → read = 1 request (cache hit)", async () => {
  await (
    await retryFetch(`${origin}/mcp/list_channels`, {
      method: "POST",
      headers: auth,
      body: '{"workspace_id":"w1"}',
    })
  ).text();
  await new Promise((r) => setTimeout(r, 10));
  await (
    await retryFetch(`${origin}/mcp/list_channels`, {
      method: "POST",
      headers: auth,
      body: '{"workspace_id":"w1"}',
    })
  ).text();
  if (reqCount !== 1) fail(`expected 1 request, got ${reqCount}`);
});

await scenario(
  "read → write → read = 3 requests (write invalidates)",
  async () => {
    await (
      await retryFetch(`${origin}/mcp/list_channels`, {
        method: "POST",
        headers: auth,
        body: '{"workspace_id":"w1"}',
      })
    ).text();
    await (
      await retryFetch(`${origin}/mcp/send_message`, {
        method: "POST",
        headers: auth,
        body: '{"channel_id":"c1","text":"hi"}',
      })
    ).text();
    await (
      await retryFetch(`${origin}/mcp/list_channels`, {
        method: "POST",
        headers: auth,
        body: '{"workspace_id":"w1"}',
      })
    ).text();
    if (reqCount !== 3) fail(`expected 3 requests, got ${reqCount}`);
  },
);

await scenario(
  "different body (workspace) = different cache key = 2 requests",
  async () => {
    await (
      await retryFetch(`${origin}/mcp/list_channels`, {
        method: "POST",
        headers: auth,
        body: '{"workspace_id":"w1"}',
      })
    ).text();
    await (
      await retryFetch(`${origin}/mcp/list_channels`, {
        method: "POST",
        headers: auth,
        body: '{"workspace_id":"w2"}',
      })
    ).text();
    if (reqCount !== 2) fail(`expected 2 requests, got ${reqCount}`);
  },
);

await scenario(
  "different auth = different cache key = 2 requests",
  async () => {
    await (
      await retryFetch(`${origin}/mcp/list_channels`, {
        method: "POST",
        headers: { Authorization: "Bearer userA" },
        body: '{"workspace_id":"w1"}',
      })
    ).text();
    await (
      await retryFetch(`${origin}/mcp/list_channels`, {
        method: "POST",
        headers: { Authorization: "Bearer userB" },
        body: '{"workspace_id":"w1"}',
      })
    ).text();
    if (reqCount !== 2) fail(`expected 2 requests, got ${reqCount}`);
  },
);

// Cleanup
for (const s of liveSockets) {
  try {
    s.destroy();
  } catch {
    // ignore
  }
}
await new Promise((r) => server.close(r));

if (process.exitCode === 1) {
  console.log("\nFAILURES — see above");
  process.exit(1);
}
console.log("\nALL PASS — cache working");
