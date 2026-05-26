#!/usr/bin/env node
/**
 * Standalone benchmark + correctness check for the shared keepalive
 * HTTP agent. Verifies the load-bearing property that vitest's
 * environment can't reliably exercise: **the second fetch through
 * the shared agent reuses the TCP socket from the first.**
 *
 * Why it lives outside vitest:
 *   • Inside vitest, undici's internal socket pool behaves erratically
 *     under module isolation — both undici-direct and global fetch
 *     open a fresh socket on the second call even with a working
 *     dispatcher. Outside vitest (plain `node`), the same code reuses
 *     the socket reliably with as little as 1 ms between calls. The
 *     production daemon runs outside vitest, so the only test that
 *     matters runs outside vitest too.
 *
 * The script reconstructs the agent with the **same config** as
 * `src/core/http-agent.ts`. Drift would be caught by the unit test
 * that asserts `sharedHttpAgent instanceof Agent` plus this script
 * being kept in sync via PR review.
 *
 * Usage:
 *     node tests/scripts/keepalive-bench.mjs        # assert
 *     node tests/scripts/keepalive-bench.mjs --bench # also print timings
 *
 * Exit code: 0 on pass, 1 on fail. CI wires this in via
 * `npm run test:keepalive` (added to package.json scripts).
 */
import http from "node:http";
import { Agent } from "undici";

const args = new Set(process.argv.slice(2));
const wantTimings = args.has("--bench");

// Same config as src/core/http-agent.ts — keep in sync.
const sharedHttpAgent = new Agent({
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
  connections: 32,
  pipelining: 1,
});

function ms() {
  return performance.now();
}

/**
 * Each scenario gets a **fresh server on a fresh port**. That isolates
 * the keepalive measurement: socket reuse from a previous scenario
 * can't bleed in (a new server = new origin = empty pool from the
 * agent's perspective). Without this, scenarios that come AFTER the
 * first one show sockets=0 because the keepalive socket from the
 * prior scenario rides over — which proves keepalive is working but
 * confuses the assertion.
 */
async function scenario(name, calls, gapMs) {
  let socketCount = 0;
  const liveSockets = new Set();
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  server.on("connection", (s) => {
    socketCount++;
    liveSockets.add(s);
    s.on("close", () => liveSockets.delete(s));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  const timings = [];
  try {
    for (let i = 0; i < calls; i++) {
      const t0 = ms();
      const r = await fetch(`${origin}/path-${i}`, {
        dispatcher: sharedHttpAgent,
      });
      await r.text();
      timings.push(ms() - t0);
      if (i < calls - 1 && gapMs > 0)
        await new Promise((r) => setTimeout(r, gapMs));
    }
  } finally {
    for (const s of liveSockets) {
      try {
        s.destroy();
      } catch {
        // ignore
      }
    }
    await new Promise((r) => server.close(r));
  }

  const expected = 1;
  const pass = socketCount === expected;
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${name.padEnd(48)}  sockets=${socketCount} (expected ${expected})${
      wantTimings
        ? `   timings=[${timings.map((t) => t.toFixed(1)).join(", ")}]ms`
        : ""
    }`,
  );
  return pass;
}

console.log(
  `Keepalive benchmark — node ${process.version}\n` +
    `───────────────────────────────────────────────────────────────────────`,
);

let allPass = true;
allPass = (await scenario("2 calls, 10ms gap", 2, 10)) && allPass;
allPass = (await scenario("5 calls, 10ms gap", 5, 10)) && allPass;
allPass = (await scenario("10 calls, 1ms gap", 10, 1)) && allPass;
// Back-to-back (no gap) is allowed to open >1 socket — undici needs
// at least one event-loop tick to release the socket back to the
// pool. As long as the realistic-gap scenarios pass, the daemon
// path is correctly reusing connections.

await sharedHttpAgent.destroy();

console.log(
  `───────────────────────────────────────────────────────────────────────`,
);
console.log(allPass ? "ALL PASS — keepalive working" : "FAILURES — see above");
process.exit(allPass ? 0 : 1);
