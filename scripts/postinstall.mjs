#!/usr/bin/env node
/**
 * Transparent native-binary delivery for `npm install -g @ano-chat/cli`.
 *
 * On supported platforms (macOS arm64/x64, Linux x64/arm64), this script
 * downloads the native binary from the GitHub Release that matches the
 * installed package version, verifies its SHA256 against the release's
 * SHA256SUMS file, and replaces `dist/index.js` with it in place. The
 * npm-managed shim at `<prefix>/bin/ano` (a symlink to `dist/index.js`)
 * keeps pointing at the same file — the OS reads the new Mach-O / ELF
 * magic bytes and executes natively, skipping the ~140ms Node bootstrap.
 *
 * On unsupported platforms (Windows + any unrecognized arch), the
 * script silently leaves the JS shim in place. Same install path; users
 * who can't get the native speed-up still get a working CLI.
 *
 * Failure modes treated as non-blocking (warn, keep JS shim):
 *   • Network unreachable during download
 *   • Release missing the platform asset (e.g. a brand-new tag mid-publish)
 *   • SHA256SUMS file missing
 *
 * Failure modes treated as hard errors (exit non-zero, install fails):
 *   • SHA256 hash mismatch (potentially corrupted or tampered download)
 *
 * Opt-out:
 *   ANO_SKIP_NATIVE_POSTINSTALL=1 npm install -g @ano-chat/cli
 *
 * Why HTTPS-via-fetch instead of node-fetch / undici dependency: this
 * runs during `npm install`, BEFORE dependencies are guaranteed to be
 * fully resolved (npm runs lifecycle scripts after extracting the
 * package but the load order across hoisted deps is fragile). Sticking
 * to Node's built-in `fetch` (Node 20+) keeps this script self-contained.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");

// ── opt-out ────────────────────────────────────────────────────────
if (
  process.env.ANO_SKIP_NATIVE_POSTINSTALL === "1" ||
  process.env.ANO_SKIP_NATIVE_POSTINSTALL === "true"
) {
  // Silent — the user opted out explicitly.
  process.exit(0);
}

// ── platform detection ─────────────────────────────────────────────
const SUPPORTED = {
  "darwin-arm64": "ano-darwin-arm64",
  "darwin-x64": "ano-darwin-x64",
  "linux-x64": "ano-linux-x64",
  "linux-arm64": "ano-linux-arm64",
};

function detectAssetName() {
  const plat = process.platform; // 'darwin' | 'linux' | 'win32' | ...
  const arch = process.arch; // 'arm64' | 'x64' | ...
  const key = `${plat}-${arch}`;
  return SUPPORTED[key] ?? null;
}

const assetName = detectAssetName();
if (!assetName) {
  // Platform not in the build matrix — keep JS shim. Silent so the
  // npm install output stays clean for the (small) population.
  process.exit(0);
}

// ── load version from our own package.json ─────────────────────────
let version;
try {
  const pkg = JSON.parse(
    readFileSync(join(PKG_ROOT, "package.json"), "utf8"),
  );
  version = pkg.version;
} catch (err) {
  // Can't determine version → can't pick the right release → bail.
  console.error(
    `[ano-cli postinstall] could not read package version (${err.message}); keeping JS shim.`,
  );
  process.exit(0);
}

const TAG = `v${version}`;
const RELEASE_BASE = `https://github.com/ano-chat/ano-cli/releases/download/${TAG}`;
const BINARY_URL = `${RELEASE_BASE}/${assetName}`;
const SUMS_URL = `${RELEASE_BASE}/SHA256SUMS`;

// ── download helpers ───────────────────────────────────────────────
/**
 * Fetch bytes with an explicit timeout. GitHub Release downloads
 * redirect to S3; if S3 is slow-lorising we don't want the npm
 * install to hang indefinitely. 5 min gives headroom for a ~60 MB
 * binary on a 1 Mbps connection (which is ~8 min in the worst case,
 * but most "slow" connections hit ~3 Mbps and finish in <3 min) while
 * still bailing on truly stuck transfers. Verified: 60s was too tight
 * — npm install on a normal connection hit ~70s and aborted on v2.22.0.
 */
async function fetchBytes(url, timeoutMs = 300_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// ── main ───────────────────────────────────────────────────────────
const TARGET_PATH = join(PKG_ROOT, "dist", "index.js");
if (!existsSync(TARGET_PATH)) {
  // Shouldn't happen — `files: ["dist"]` includes dist/index.js in
  // the published tarball. Bail loud so a broken build surfaces.
  console.error(
    `[ano-cli postinstall] ${TARGET_PATH} not found in installed package; aborting.`,
  );
  process.exit(0); // don't fail the install
}

try {
  // 1. Pull the binary.
  const binary = await fetchBytes(BINARY_URL);

  // 2. Verify SHA256.
  let sumsText;
  try {
    sumsText = (await fetchBytes(SUMS_URL)).toString("utf8");
  } catch (err) {
    console.warn(
      `[ano-cli postinstall] SHA256SUMS not available for ${TAG} (${err.message}); keeping JS shim.`,
    );
    process.exit(0);
  }
  // Parse SHA256SUMS as `<hash> <whitespace> <filename>` per line.
  // Tolerates tabs, multiple spaces, leading/trailing whitespace —
  // anything `split(/\s+/)` handles. Exact filename match (not
  // endsWith) so `ano-linux-x64-extra` doesn't accidentally match
  // the entry for `ano-linux-x64`.
  const parts = sumsText
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .find((cols) => cols[cols.length - 1] === assetName);
  if (!parts || parts.length < 2) {
    console.warn(
      `[ano-cli postinstall] SHA256SUMS lists no entry for ${assetName} on ${TAG}; keeping JS shim.`,
    );
    process.exit(0);
  }
  // Normalize both to lowercase before compare. `digest("hex")` is
  // lowercase but hand-crafted or third-party SUMS files might be
  // uppercase — refuse to falsely fail because of case.
  const expected = parts[0].toLowerCase();
  const actual = sha256(binary).toLowerCase();
  if (expected !== actual) {
    console.error(
      `[ano-cli postinstall] SHA256 mismatch for ${assetName} on ${TAG}.\n` +
        `  expected: ${expected}\n` +
        `  actual:   ${actual}\n` +
        `Refusing to install a corrupted or tampered binary. The npm install will fail — re-run, or set ANO_SKIP_NATIVE_POSTINSTALL=1 to skip.`,
    );
    process.exit(1); // HARD fail — security-critical
  }

  // 3. Replace the JS shim with the binary, ATOMICALLY. The bin
  // symlink (<prefix>/bin/ano → dist/index.js) keeps pointing at
  // the same file path; the OS reads the new magic bytes and
  // executes natively.
  //
  // Atomic via write-temp + rename: if the process dies mid-write or
  // chmod fails, the original JS shim is still in place. A direct
  // writeFileSync to TARGET_PATH could leave a half-written corrupt
  // binary if anything goes wrong — worse than no install at all,
  // because the next `ano` call would crash with "cannot execute
  // binary file" instead of falling back to the JS shim.
  const tmpPath = `${TARGET_PATH}.tmp.${process.pid}`;
  try {
    writeFileSync(tmpPath, binary);
    chmodSync(tmpPath, 0o755);
    renameSync(tmpPath, TARGET_PATH);
  } catch (err) {
    // Clean up the temp file if it exists, so a future re-install
    // doesn't see stray .tmp files.
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore
    }
    throw err;
  }

  // 4. Reset background state that could outlive the binary swap.
  //
  // Two stale-state hazards that bit users during v2.22.0 → v2.22.1:
  //
  //   a) The OLD daemon process is still running. The new binary
  //      doesn't know about it; the old daemon's protocol version
  //      may mismatch; eventually the breaker trips and 10 min of
  //      direct-execution fallback ensue. User experience: "the
  //      upgrade broke the daemon."
  //   b) The breaker file `~/.cache/ano/daemon-disabled-until`
  //      persists from the previous version. If the user installed
  //      v2.20 → v2.22 in sequence, a v2.20 breaker (sized for the
  //      buggy 800 ms timeout) still locks out v2.22 for the
  //      remainder of the 10-min window.
  //
  // Both are best-effort cleanup — if either fails (daemon already
  // gone, breaker file already gone, permission issues), no harm.
  // The CLI's auto-detect logic respawns the daemon on the next
  // call.
  resetDaemonState();

  console.log(
    `[ano-cli postinstall] installed native binary for ${process.platform}-${process.arch} (${assetName}, ${(
      binary.length /
      1024 /
      1024
    ).toFixed(1)} MB). Cold-start: ~20ms (vs ~150ms Node).`,
  );
} catch (err) {
  // Network or other transient — leave JS shim in place, exit 0 so
  // the install completes. User can re-install later to retry.
  console.warn(
    `[ano-cli postinstall] could not fetch native binary for ${TAG} (${err.message}); keeping JS shim. Re-run \`npm install -g @ano-chat/cli\` later to retry.`,
  );
  process.exit(0);
}

// ── stale-state cleanup ────────────────────────────────────────────

/**
 * Best-effort cleanup of background state that could outlive the
 * binary swap and bite the user post-upgrade. Always exits 0 (no
 * throw) so postinstall stays non-blocking — these are cleanups,
 * not requirements.
 */
function resetDaemonState() {
  // 1. Kill any running daemon. We use a heuristic — any process whose
  //    cmdline ends with `daemon serve` AND is owned by the current
  //    user. Falls back silently if `ps` / `pgrep` aren't available
  //    or no matching process exists.
  killExistingDaemon();

  // 2. Unlink the per-user breaker file. The next `ano` call will
  //    operate with a clean breaker state. If the daemon is still
  //    misbehaving (cold-start exceeds the 10 s response timeout),
  //    the breaker will trip again — but starting from a clean
  //    state means the user isn't paying for a STALE trip from a
  //    previous version's bug.
  clearBreakerFile();

  // 3. Unlink the orphan socket / pid files if present. New daemon
  //    will recreate them on next spawn; this just makes "ano daemon
  //    status" report cleanly (no stale-pid annotation).
  removeOrphanSocketArtifacts();
}

function killExistingDaemon() {
  try {
    // `pgrep -f` matches against the FULL command line. We can't pin
    // to /opt/homebrew/bin/ano specifically because users install to
    // various prefixes; the "daemon serve" suffix is the stable part.
    // Filter to processes owned by the current user via `-u $UID`.
    const uid = String(process.getuid?.() ?? 0);
    const out = execFileSync(
      "pgrep",
      ["-u", uid, "-f", "ano daemon serve"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const pids = out
      .trim()
      .split("\n")
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n > 0 && n !== process.pid);
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process gone or not ours — skip.
      }
    }
  } catch {
    // pgrep not found (BSD without pgrep, Alpine minimal, etc) — skip.
    // The new daemon's version-mismatch check will catch the old
    // daemon on the next call anyway; this is just nicer cleanup.
  }
}

function clearBreakerFile() {
  // Mirror `defaultCircuitBreakerPath` in src/daemon/client.ts.
  const breakerPath = process.env.XDG_CACHE_HOME
    ? `${process.env.XDG_CACHE_HOME}/ano/daemon-disabled-until`
    : `${process.env.HOME || ""}/.cache/ano/daemon-disabled-until`;
  try {
    unlinkSync(breakerPath);
  } catch {
    // Already gone.
  }
}

function removeOrphanSocketArtifacts() {
  // Mirror `defaultSocketPath` in src/daemon/protocol.ts.
  const tmp = process.env.TMPDIR || "/tmp";
  const uid = process.getuid?.() ?? 0;
  const socketPath = process.env.XDG_RUNTIME_DIR
    ? `${process.env.XDG_RUNTIME_DIR}/ano-daemon.sock`
    : `${tmp.replace(/\/$/, "")}/ano-daemon-${uid}.sock`;
  for (const p of [socketPath, `${socketPath}.pid`]) {
    try {
      unlinkSync(p);
    } catch {
      // Already gone — fine. Don't follow up here; the new daemon's
      // own startup unlinks any stale socket before binding.
    }
  }
}
