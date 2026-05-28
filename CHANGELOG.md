# Changelog

All notable changes to the `ano` CLI are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/).

## [2.24.1] — 2026-05-28

### Added

- **`ano messages read --channel <id>` now serves from the Zero
  replica.** Uses the monorepo's `messages.byChannelComposite`
  named query — same access guard the desktop uses
  (`channelMemberGuard(sub)`). Cold call ~400 ms (server
  materializes the query, fills replica, returns); warm calls
  serving the same channel ~60 ms wall time (Node startup +
  daemon RPC + local SQLite read).
- Per-channel subscription model: each channel is its own
  subscription. The first read of a new channel pays the cold
  cost. After a few minutes of normal use, the replica naturally
  warms across the channels the user actually touches.

### Changed

- **Schema relation `messages.author` renamed to
  `messages.sender`** to match the monorepo's relationship name
  (`packages/shared/src/schema/index.ts`). Without this rename,
  rows materialized from the server's `messages.byChannelComposite`
  (which does `.related("sender")`) wouldn't map correctly into
  the local replica.

### Notes

- `ano messages search "..."` still uses REST. The monorepo has
  no equivalent named query for full-text search — server-side
  FTS isn't exposed via Zero today. Adding it requires a new
  named query upstream (`messages.byContentLike` or similar);
  tracked as a future enhancement. The REST path takes ~150 ms,
  which is acceptable for an interactive search command.
- Across the four hot read commands:
  - ✅ `ano channels list` → Zero
  - ✅ `ano users list --workspace W` → Zero
  - ✅ `ano messages read --channel C` → Zero (new in 2.24.1)
  - ⏳ `ano messages search` → REST (no server-side named query)

## [2.24.0] — 2026-05-28

### Added

- **Zero reads now actually serve data from the local replica.**
  Three bug fixes had to land together:
  1. **Pass `context: { sub: userId }` to `new Zero({...})`.** Zero's
     `addContextToQuery` calls `query.query.fn({ctx: context, args})` —
     without `context` set in the constructor, every named query's
     `ctx.sub` access throws `Cannot read properties of undefined`,
     the catch swallows it, and we silently fall back to REST.
     Matches the desktop's setup (`apps/desktop/src/lib/zero.ts:17`).
  2. **Use named queries from a CLI-side `cliQueries` registry.**
     Anonymous `zero.query.X.where(...)` produces queries with no
     `queryName`; the server's `mustGetQuery(queries, name)` in
     `server/app-zero-sync-routes.ts:270` rejects them and never
     streams table data. The CLI now defines
     `cliQueries.channels.activeByUser` +
     `cliQueries.workspace_members.byWorkspace` with paths matching
     the monorepo's `packages/shared/src/queries/index.ts`.
  3. **Call `zero.run(queryRef, {type: "complete"})`.** The default
     `zero.run()` returns whatever's in the local replica
     immediately (empty on cold start); with `{type: "complete"}`
     it waits for the server to materialize the query result into
     the replica.

  Verified end-to-end against `api-staging.ano.dev`: cold call 3 ms,
  warm call 0 ms, total CLI wall time **54 ms** (Node startup +
  daemon RPC + local SQLite read), 21 channels returned.

- Read helpers migrated: `ano channels list` (channels.activeByUser),
  `ano users list --workspace W` (workspace_members.byWorkspace).
  `ano messages read` + `ano messages search` still use legacy
  queries (and fall back to REST via v2.23.3) — migrating those
  needs the right named query in the monorepo
  (`messages.byChannelComposite` or similar; pending a closer
  look).

### Notes

- Drift policy: when the monorepo renames a query (or changes its
  argument shape), `src/zero/queries.ts` must update in lockstep.
  Failure mode is loud — server replies with "unknown query name"
  and reads fall back to REST. Same shape as `mutators.ts`.
- `enableLegacyQueries: true` stays on the schema for now. Once
  the remaining helpers (messages.read, messages.search) move to
  named queries, that gate can come off.
- Test mocks updated to stub `zero.run()` instead of the legacy
  `zero.query.X.where(...)` chain. Wire is simpler; mocks are too.

## [2.23.3] — 2026-05-28

### Fixed

- **Empty Zero result now falls back to REST** instead of surfacing
  `(empty)` to the user. v2.23.2's read helpers trusted Zero's
  empty-array response as "workspace genuinely has 0 rows"; in
  practice, empty-from-Zero today is dominated by the staging
  server's data-streaming bug (the customQueryTransformer doesn't
  fill the replica for anonymous legacy queries — investigation
  ongoing). Falling back is asymmetrically safe: ~100ms wasted on a
  truly empty workspace (rare), vs returning correct data when the
  Zero pipeline is degraded (current persistent state).

- Applies to all four read helpers: `channels list`, `users list`,
  `messages read`, `messages search`. Each one returns `null` (the
  caller-falls-back-to-REST signal) when `q.run()` resolves to
  `[]`.

### Notes

- This is a heuristic, not a permanent design. Once the Zero
  data-streaming path is fixed (likely v2.24.0 — vendored named
  queries from `packages/shared/src/queries/`), we'll either drop
  this fallback or scope it tighter (e.g. only fall back if
  daemon uptime < 60s, suggesting cold start).
- Drift detection unchanged: empty results don't register drift
  (no sample row to validate columns against).

## [2.23.2] — 2026-05-27

### Fixed

- **Bun-compiled binary couldn't load `better-sqlite3`.** The npm
  postinstall delivers a Bun-compiled native binary on macOS/Linux
  (the default for `npm i -g @ano-chat/cli`). `bun build --compile`
  bundles JS only — it doesn't ship Node's native `.node` addons —
  so `better-sqlite3`'s native binding wasn't reachable at runtime
  and Zero bootstrap silently failed for everyone on the binary
  path. v2.23.1's fixes worked for the JS fallback only.
- **New `src/zero/sqlite-runtime.ts` adapter** detects Bun runtime
  (`"Bun" in globalThis`) and routes to `bun:sqlite` (a Bun
  built-in, always available, no native addons required); falls back
  to `better-sqlite3` under Node. Same `CompatDatabase` surface
  either way, so `kv-sqlite.ts` doesn't branch on runtime.
- `tsup.config.ts` marks `bun:sqlite` as external — esbuild can't
  resolve it (not in node_modules), and the dynamic-import only
  fires under Bun at runtime, gated by the `globalThis.Bun` check.

### Notes

- `db.pragma(setting)` is preserved through the adapter (routes to
  better-sqlite3's native `pragma()` on Node; emulated via
  `exec("PRAGMA …;")` on Bun). An earlier draft used `exec` for
  both backends; testing showed better-sqlite3's `pragma()` has
  subtle side effects beyond just running the statement, and
  replacing it regressed Zero replica sync.
- Pre-load + sync-create pattern: the kvStore provider awaits the
  driver import ONCE at Zero bootstrap, then `SQLiteStore`'s
  per-store synchronous factory contract is satisfied by
  `syncCreateDatabase` reading from the cached driver.

## [2.23.1] — 2026-05-27

### Fixed

- **Zero never actually engaged in v2.23.0** — manual smoke test
  uncovered five distinct failure modes that all caused the daemon
  to silently fall back to REST despite reporting `zero: connected`:
  1. **`localStorage` missing** in Node 22+/Bun. Zero's
     `idb-databases-store` crashes on `getItem is not a function` at
     construction. Added `installLocalStoragePolyfill()` that runs
     before `@rocicorp/zero` is imported. Persists `profileId` to
     `~/.cache/ano/zero/profile-id` so it survives daemon restarts.
  2. **Vendored schema declared columns that Zero doesn't
     replicate** (`channels.deleted_at`, `messages.parent_id`,
     `messages.thread_root_id`, `messages.edited_at`, `users.handle`,
     `workspaces.deleted_at`). Zero server rejected the WebSocket
     handshake with `SchemaVersionNotSupported`. Removed those
     columns; documented that soft-delete is publication-filtered.
  3. **`enableLegacyQueries` not set on schema.** Zero v1.5+ returns
     `undefined` from `zero.query.X` unless the schema opts into the
     legacy query DSL (the new API is `zero.run(zql.X.where(...))`).
     Added `enableLegacyQueries: true` to `createSchema`. Migrating
     to the new API is a follow-up.
  4. **`ano connect` (SSE bridge — a long-running server) was being
     dispatched THROUGH the daemon's serial queue**, hanging it
     forever and tripping every client's circuit breaker for 10 min.
     Added `connect` to the client-side `BYPASS_TOP_LEVEL` set AND
     a server-side guard in the daemon's `exec` handler that replies
     with `unknown_method` so external callers (e.g. `npm exec
ano-connect`) can't hang the daemon either.
  5. **`channels list` over Zero returned DMs and spaces** because
     all three types share the `channels` table and the previous
     Zero query only filtered `is_archived`. Added
     `where("type", "=", "channel")` to match REST.

- **`messages.body` → `messages.content`** in the vendored schema +
  reads.ts. The monorepo column is `content`; reading `r.body`
  returned undefined. Caught during the same audit.

### Notes

- Without these fixes v2.23.0 had `zero: connected` in `daemon
status` but every read silently went through REST anyway, giving
  v2.22-equivalent performance instead of the advertised ~10×
  speedup. v2.23.1 closes the loop.
- Manually smoke-tested against `api-staging.ano.dev`: cold-call 51 ms,
  warm-call 48 ms (full Node startup + daemon RPC + local SQLite
  query); `q.run()` itself resolves in 0–2 ms.

## [2.23.0] — 2026-05-27

### Added

- **Embedded Zero replica in the daemon (default ON).** The daemon
  now constructs a `@rocicorp/zero` client at startup, authenticated
  via a JWT minted from the user's `ano_usr_*` API key (server
  endpoint: `POST /api/cli/zero-jwt`). A local SQLite replica lives
  at `~/.cache/ano/zero/user_<id>.sqlite`. Four read commands serve
  from local SQLite (microsecond reads) instead of REST (~150–300 ms):
  - `ano channels list`
  - `ano users list`
  - `ano messages read`
  - `ano messages search`
    Falls back to REST on any Zero miss (cold replica, timeout, error,
    or unreachable mint endpoint), so the speed-up is opportunistic
    and never blocks a command. Users authenticated against
    environments where the mint endpoint hasn't shipped yet see
    identical behavior to v2.22.x.
- **Opt-out gate: `ANO_DISABLE_ZERO=1`.** Set this env var + restart
  the daemon to fully disable the Zero path. Useful for pinning
  behavior to the REST + cache stack during the v2.23.0 soak.
- **Websocket-drop guard.** If Zero's WebSocket to `sync-*.ano.dev`
  drops (network blip, server restart, suspend/resume), reads
  transparently fall back to REST until reconnect — no risk of
  serving stale data from a desynced replica. Zero's own retry
  logic handles the reconnect; the daemon mirrors the connection
  state to gate read traffic. Zero-touch for users.
- **Schema-drift detection.** If the CLI's vendored schema disagrees
  with the server's row shape on a table (e.g. a column was renamed
  server-side), reads on that table register the drift, log one
  stderr line, and fall back to REST for the rest of the daemon's
  lifetime. Other tables continue to use Zero. Catches the silent-
  failure class where reads would otherwise return rows with
  `undefined` fields. Zero-touch for users.
- `ano daemon status` reports the Zero connection state, replica
  size, and any drifted tables when active; distinguishes opt-out
  vs bootstrap-failure when off.

### Changed

- **Response cache carve-out** (default-on): `/list_channels` and
  `/list_users` skip the 5s TTL cache. A Zero miss on those paths
  falls through to a fresh server read instead of a stale cached
  value masking the outage. `/list_workspaces`, `/list_tables`,
  `/get_table` continue to be cached (not yet Zero-backed). Set
  `ANO_DISABLE_ZERO=1` to restore pre-v2.23.0 cache behavior.

### Fixed

- **`messages.content` schema drift.** The vendored CLI schema declared
  `messages.body` while the monorepo column is `messages.content` —
  reads via Zero would have returned messages with `content: undefined`.
  Caught in development; fixed at the schema level AND covered by the
  runtime drift detector for future drift of the same shape.

### Notes

- Write commands (`messages send`, `channels archive`, etc.) still
  go through REST in this release. The Phase 3 write-through-Zero
  work is in flight as a follow-up (PR #58) pending real-world
  smoke validation.

## [2.19.0] — 2026-05-13

### Added

- **Cross-region workspace listing (decision 8, multi-region master plan).**
  `ano auth login` and `ano auth complete` now hit the D1 control plane's
  globally-consistent `GET /cp/workspaces` to enumerate workspaces. Pre-
  fix, a US-resident caller signing in through `api.ano.dev` would see
  only US workspaces in the picker — EU memberships were invisible
  because the legacy `/api/cli-keys/workspaces` endpoint queries the
  in-region Postgres. The new path returns every workspace regardless
  of region.
- The `--print-workspaces` JSON output now includes a `region` field
  per workspace so orchestrators that pick a workspace can pass it to
  the API key minter on the right regional endpoint without an extra
  `/route` round-trip.
- Profile records (`~/.config/ano/credentials.json`) gain an optional
  `region` field for "what region is this profile pinned to?" queries.
  Informational today; routing is still driven by the persisted
  `endpoint`.

### Changed

- **API key minting routes by workspace region BEFORE the mint, not
  after.** `api_keys` rows are foreign-keyed to `workspaces(id)` in
  regional Postgres, so an EU workspace's key MUST be minted at
  `api-eu.ano.dev/api/cli-keys`. Pre-fix, the mint hit whatever the
  configured endpoint resolved to (US, for the apex). For EU
  workspaces this would have failed the FK check.
- **Apex-only guard** on the regional swap: `regionalApiUrl()` maps to
  production hosts only, so a staging session whose workspace has
  `region: "us"` MUST keep its mint on staging — otherwise we'd send
  the staging WorkOS token to prod and save an api_key pointing at the
  wrong environment.
- Graceful fallback: when the server doesn't yet expose `/cp/*`
  (older/self-hosted deployments), the CLI falls back to the legacy
  `/api/cli-keys/workspaces` + `/route` resolver chain. Same on-disk
  shape, just without cross-region visibility — which is correct for
  single-region servers.

## [2.18.1] — 2026-05-13

### Fixed — daemon health pre-flight (no more 30s hangs)

The CLI now sends a fast `ping` (≤1s deadline) to the daemon before
every `exec` dispatch. If the daemon socket exists but the process
can't reply — wedged dispatch loop, OOM thrash, partial protocol
upgrade, OS sleep recovery — the client SIGKILLs the stale process
via the PID file, unlinks the socket, fires off a fresh daemon, and
falls back to direct execution for the current call. Previous
behavior: wait the full 30s exec timeout for a reply that never
came.

Also tightened the exec response deadline from 30s → 10s. The
daemon's own per-dispatch timeout is still 60s; the client now
gives up sooner because the pre-flight ping has already weeded out
unresponsive daemons.

Catches the same drift case where an upgraded CLI binary was still
talking to a daemon spawned by the prior version — now the version
mismatch surfaces in the ping reply (∼50 ms) rather than waiting
on the next `exec`.

## [2.18.0] — 2026-05-13

### Added — file attachments via `--file`

`ano messages send` and `ano dm send` accept a new `--file` flag.
Each invocation uploads the file to R2 via `POST /mcp/upload` and
posts a message with the attachment row in one server-side
transaction. Empty content + `--file` is allowed (image-only sends).

```
ano messages send "see screenshot" -n engineering --file ./bug.png --agent
ano messages send "logs" -c <id> --file ./out.txt --file ./err.txt --agent
ano messages send "" -n design --file ./shot.png --agent     # image-only
ano dm send "fyi" --to Alice --file ./report.pdf --agent
ano dm send "shared report" --to Alice --to Bob --file ./out.pdf --agent
```

Path resolution is dedupe-aware (`--file a.png --file a.png` uploads once)
and supports comma-separated batches (`--file a.png,b.png`). Per-file
cap is 25 MB (server-enforced); per-invocation total cap is 125 MB
(pre-flight check, fails fast before any upload). Supported types
mirror the existing `/api/upload` allowlist (images, video, audio,
PDF, office docs, text, JSON, zip, tar, gzip).

The send response now includes `attachment_ids: string[]` whenever
`--file` was used.

## [2.17.0] — 2026-05-13

### Added — group DMs (Slack-style MPIM)

`ano dm send` accepts multiple recipients now. Repeat the flag,
pass comma-separated, or pass variadic — they all collapse to one
deduped recipient list. ≥2 distinct recipients → group DM (Slack
calls these MPIMs); 1 → existing 1:1 DM (unchanged).

```
ano dm send "perf-test friday afternoon" \
  --to Alice --to Bob --to Carol --agent

ano dm send "..." --to "Alice,Bob,Carol" --agent       # comma form
ano dm send "..." --to Alice Bob Carol --agent         # variadic form

ano dm send "..." --to Alice --user-id u-bob --agent   # mixed name + id
```

Idempotent on the unordered member set: repeating the same `--to`
combo always lands in the same channel forever (Slack convention —
group-DM membership is immutable; to change participants, start a
new conversation).

`--email` stays single-recipient only — group DM by email isn't
supported yet (no compelling use case; the typed-id / typed-name
paths cover the agent flow).

Pairs with the existing `mutators.actions.getOrCreateGroupDM` Zero
mutator + the desktop `NewDMDialog` multi-select that's been there
all along — closes the gap on the agent + CLI side so anyone (not
just human Electron users) can start group DMs.

### Internal

- `ApiClient.sendDm` type widened to accept `recipient_names[]` /
  `user_ids[]`; return type now `SendDmResult | SendGroupDmResult`.
- Server-side `sendGroupDm` op + `/mcp/send_dm` group dispatch ship
  in [project-ano#NN](https://github.com/LeoNilsson/project-ano).

### Tests

`tests/unit/dm-send.test.ts` (8 cases) covers the recipient
normaliser (variadic, comma-separated, repeated, deduped, mixed
flag types) + the 1:1-vs-group dispatch decision + the no-recipient
and `--email`+group rejection paths. Total CLI suite: 204 passing.

## [2.16.2] — 2026-05-13

### Fixed — daemon read wrong credentials.json under HOME redirect

`src/core/config.ts` cached `CONFIG_DIR = join(homedir(), ".config", "ano")`
at module load time. The daemon imports `config.ts` once at startup,
freezing the path against the daemon's startup HOME.

When a request came from the Ano in-app PTY shell (HOME redirected to
`~/.ano/dev/shell-home`), the daemon's `dispatch()` correctly replaces
`process.env` with the caller's env — but `loadGlobalCredentials()`
still used the cached `CONFIG_DIR` and read the wrong file. Result:
`ano messages send` from the in-app shell hit STAGING (the daemon's
own `default` profile in main creds) instead of the LOCAL endpoint
the in-app shell expected (its `default` profile in shell-home creds).

Smoke didn't catch this because `dev` is in the daemon-bypass list —
it ran in the calling process where `os.homedir()` returns the
correct redirected HOME.

Fix: resolve `configDir()` per call via `homedir()` instead of
caching at module load. Three regression tests in
`tests/unit/config.test.ts` pin the per-call resolution + the
HOME-switch behaviour.

## [2.16.1] — 2026-05-13

### Fixed (review pass)

- `ANO_NO_AUTO_LOCAL` and `ANO_QUIET_PROFILE_HINT` now accept both
  `"1"` and `"true"` (case-insensitive) — matches the convention
  every other env-var check in the CLI uses (e.g. `ANO_NO_DAEMON`).
  Previously only `"1"` worked; `=true` was silently ignored. Helper
  extracted as `isEnvFlagSet()` for consistency across new env vars.
- 2 new tests pin both the `=true` and `=TRUE` paths.

## [2.16.0] — 2026-05-13

### Added — auto-local in monorepo

When the CLI is invoked from a directory under a checkout where
`npm run dev:local` is currently running (signal:
`.ano/dev/postgres/postmaster.pid` exists in cwd or any ancestor),
AND a `local` profile exists in `~/.config/ano/credentials.json`,
the CLI now uses the `local` profile automatically instead of
silently sending to staging.

A one-line hint goes to stderr so the choice is never invisible:

```
→ profile: local (auto — dev:local stack detected; pass --profile default to override)
```

### Why

Caught when an agent session ran `ano messages send "hello, friends!"
--channel-name design` while the user was actively testing locally.
The message went to **staging** (the global default) instead of the
local stack the user could see in their Electron window. Real footgun.

### Doesn't fire when

- `--profile <name>` / `ANO_PROFILE=<name>` was set explicitly
- `--key` / `ANO_API_KEY` set explicitly
- A project-level `.ano/config.json` provides a key
- `ANO_NO_AUTO_LOCAL=1`
- CWD is outside any directory with the `dev:local` Postgres marker
- No `local` profile exists

### Quiet variant

`ANO_QUIET_PROFILE_HINT=1` suppresses the stderr hint while still
auto-picking. Useful for scripts that want clean stdout/stderr but
trust the auto-pick.

### Tests

6 new in `auth.test.ts` covering the matrix: cwd-under-running-stack,
cwd-outside, no-local-profile-exists, ANO_NO_AUTO_LOCAL, explicit
`--profile default` overrides, ANO_QUIET_PROFILE_HINT.

## [2.15.0] — 2026-05-13

### Added — global `--profile` flag

```
$ ano --profile local channels list --agent     # uses ~/.config/ano/credentials.json[local]
$ ANO_PROFILE=local ano channels list --agent   # same via env var
```

Previously `--profile` only existed at `auth login` time (for SAVING
to a profile). There was no way to USE a non-`default` profile from
the global CLI without manually passing `--key <key> --endpoint <url>`
or setting env vars by hand. The `dev:local` flow auto-provisions a
`local` profile in `~/.config/ano/credentials.json`, but invoking it
required this flag.

Resolution order (unchanged for everything except the new `--profile`):

1. `--key` flag → use it
2. `ANO_API_KEY` env → use it
3. `.ano/config.json` (project) → use it
4. `~/.config/ano/credentials.json` →
   - `--profile X` / `ANO_PROFILE=X` → look up profile X (errors with
     a list of available profiles if missing — never silently falls
     through to `default`)
   - otherwise → `default`, then first profile

3 new tests in `tests/unit/auth.test.ts`.

## [2.14.0] — 2026-05-13

### Added — `ano dev smoke`

One-command sanity check that runs the canonical CLI surface against
the active profile and reports per-call timings + a one-line summary.
Pairs with the monorepo's `dev:local` auto-provisioning to give devs a
sub-second answer to "did my change break the shell↔CLI flow?"

```
$ ano --profile local dev smoke
✓ context           48ms Local Dev · Ruben Flam
✓ channels list     32ms 3 channels
✓ users list        29ms 1 user
✓ tables list       30ms 0 tables
✓ messages send     45ms → m_abc (#test-history)
all green · 5/5 in 184ms · daemon: warm (pid 1234, v2.14.0)
endpoint: http://127.0.0.1:3001
```

Flags:

- `--no-write` — skip the message-send step (read-only smoke against
  rate-limited environments)
- `-c, --channel-name <name>` — override the default channel pick
- `--agent` / `--json` — emit a JSON envelope instead of the table

Channel picking order: `test-history` → `test-*` → `random` → first
messageable. Keeps smoke writes out of business-relevant channels.

Bypassed by the daemon (always runs in the calling process) so the
summary can probe daemon state and report it accurately.

## [2.13.3] — 2026-05-13

### Fixed (review pass)

- `daemon/server.ts` — dispatch error reply now sends `err.message` only
  (previously sent `err.stack`, leaking the daemon's absolute file
  paths and noisy frames into the client's stderr).

### Tests

- `daemon-timeout.test.ts` — widened the elapsed-time tolerance from
  600 ms to 2000 ms. The original bound was tight against the test
  client's connect-retry loop (~500 ms worst case); the meaningful
  assertion is "not 30 s", not "exactly 100 ms".
- `retry.test.ts` — new test verifies the new default `maxRetries=2`
  also caps 502 retries (3 total attempts then throw). Previously the
  502 test passed `maxRetries: 5` and never exercised the new default.

## [2.13.2] — 2026-05-13

### Changed — spotless CLI failure mode

The CLI's underlying `retryFetch` previously retried HTTP 429 (rate
limit) responses silently with exponential backoff (up to ~30 s per
attempt, 10 attempts). On rapid-fire calls that tripped the server's
60 req/min limit, this turned a fast error into a multi-second hang
inside the daemon's serial dispatch — the very thing the v2.13.1
timeout fix was a band-aid for.

New defaults match the SKILL.md contract — fail fast, surface the
exit code, let the caller decide:

- **HTTP 429** → return immediately, no waiting. The api-client throws
  `RateLimitError` → CLI exits with code 5. Agent backs off per the
  documented "wait 10+ seconds" rule.
- **Network errors** (`ECONNREFUSED`, `ETIMEDOUT`, etc.) → max 2
  retries by default (was 10). A stuck connection no longer adds
  ~30 s to a CLI command.
- **5xx (502/503/504)** — same retry logic as before, but the new
  default `maxRetries=2` applies (was 10). `500` is still capped at
  2 (application errors aren't usually transient).
- **Other 4xx** → unchanged: `PermanentError`, no retry.

### Internal

- `retryFetch` accepts a new `retryRateLimit?: boolean` option.
  Default `false` (CLI behaviour). The `bridge/` long-running
  connector (used by `ano connect` to OpenClaw) opts back into the
  historical generous retry budget via
  `{ maxRetries: 10, baseDelayMs: 1000, maxDelayMs: 30000, retryRateLimit: true }`.
- New `tests/unit/retry.test.ts` (11 cases) pins the new defaults
  and the bridge override path.

## [2.13.1] — 2026-05-13

### Fixed

- **Daemon dispatch deadlock under sustained load.** Pre-fix, if a
  dispatched command hung indefinitely (server rate-limit retry
  loops, awaited fetch that never resolved, etc.) the serial queue
  blocked forever — every queued request behind it timed out. Now
  each dispatch is wrapped in a 60 s timeout; on timeout the daemon
  replies with `code: "internal"` + a "restarting" message and
  `process.exit(0)`s. The next call falls through to direct execution
  via the existing client fallback and opportunistically respawns a
  fresh daemon. Bulletproof for the symptom; deeper audit of which
  commands leak module-scope state is a follow-up.

### Internal

- `startDaemon` now accepts `dispatchTimeoutMs` (test override) plus
  two underscore-prefixed test hooks: `_dispatchOverride` (replace
  the dispatch function) and `_onShutdown` (replace `process.exit`).
- New `tests/unit/daemon-timeout.test.ts` (1 test) pins the
  reply-then-shutdown behaviour using a hanging dispatch override.

## [2.13.0] — 2026-05-12

### Added

- **`ano-daemon`** — long-lived background process that holds the warm
  Node bundle, eliminating the ~140 ms cold-start tax on every CLI
  call. Measured impact at staging-from-Sweden: logical action
  ("find #channel + send") drops from 511 ms → 251 ms (51 % faster).
  Per-call CLI tax drops from ~135 ms to ~12 ms.
- **`ano daemon start|stop|status`** — user-facing controls for the
  daemon process. `status` reports PID, socket path, uptime, and the
  daemon's CLI version.

### Changed

- The `ano` shim is now ~4.4 KB (down from 148 KB). The full command
  tree is dynamic-imported only when the daemon path doesn't apply,
  so warm-daemon calls skip the heavy parse entirely.
- On every invocation: try the daemon socket first (~5 ms) → fall back
  to today's direct execution path on any failure. First call after
  install is identical to today's speed; the daemon is opportunistically
  spawned in the background for the next call.

### Bypass rules

The daemon path is skipped automatically for:

- `ANO_NO_DAEMON=1` env var
- `ano daemon …` itself
- `ano auth login | complete | refresh-region | logout` (browser/file
  interactions clearer in the calling shell)
- Any argv reading stdin (`--file -`, `-f -`, `--file=-`)

### Internal

- New protocol module (`src/daemon/protocol.ts`) defines the
  newline-delimited JSON wire format. Protocol version `v1`.
- The daemon includes its own CLI version in every response. On
  CLI-version mismatch (user upgraded npm package while daemon is
  warm) the daemon rejects the request and self-shuts-down so the
  next call gets a fresh daemon matching the new CLI.
- Idle exit: 10 minutes of no requests → daemon exits.
- Serial dispatch — one command at a time per daemon process. Avoids
  cross-request stdout/cwd/env bleed.

## [2.12.0] — 2026-05-12

### Added

- `ano messages send --channel-name <name>` (`-n`) — resolves the
  channel name on the server in the same call as the message insert.
  Saves the previous `ano channels list` round trip when the agent
  knows the channel name but not the id. Works with the `<ano_payload>`
  flow and any other "post in #foo" prompt. Pairs with the matching
  `ano-skills` invariant update.

### Changed

- `ano messages send` no longer requires `--channel`. Either
  `--channel <id>` or `--channel-name <name>` is accepted; the CLI
  errors clearly when neither is provided.
  > > > > > > > origin/main

## [2.11.1] — 2026-05-11

### Fixed

- `package.json` `repository.url` updated from the pre-transfer
  `LeoNilsson/ano-cli` URL to the canonical `ano-chat/ano-cli` URL. The
  npm publish for 2.11.0 was rejected by sigstore provenance validation
  because the repository URL in `package.json` didn't match the GitHub
  Actions provenance source. No functional code changes; 2.11.1 ships
  the same code as 2.11.0 plus this registry-metadata fix.

## [2.11.0] — 2026-05-11

### Added

- **Region-aware login (WS-B11).** `ano auth login` and `ano auth complete`
  now call the Worker's `/route?workspace_id=<id>` lookup after minting a
  CLI key and persist the resolved regional API URL (`api-us.ano.dev` or
  `api-eu.ano.dev`) directly into `~/.config/ano/credentials.json`. Every
  subsequent command reads the regional URL from disk and skips the apex
  geo-router hop. Mirrors the desktop + iOS clients that shipped tonight.
- `ano auth refresh-region [--profile <name>]` — one-shot upgrade path for
  users with pre-2.11 profiles. Re-resolves the workspace's region and
  rewrites the profile endpoint if the apex is still pinned. Idempotent.
- Profile records now persist `workspace_id` alongside the existing
  `workspace_name`. `auth refresh-region` needs this to ask the Worker
  which region a workspace lives in.

### Notes

- Best-effort resolution: if `/route` is unreachable or returns an
  unexpected shape, `auth login` falls back to the apex `api.ano.dev`
  endpoint. The CF Worker still geo-routes correctly at runtime — the
  optimization is skipping one round-trip per command on subsequent
  invocations, not unlocking new functionality.
- `/route` is only mounted on `api.ano.dev`; the resolver is a no-op
  when the user has explicitly overridden the endpoint
  (`api-staging.ano.dev`, regional URLs, or any custom host).

## [2.10.0] — 2026-05-10

### Added

- `ano session start|update|end` — record the workstream a Claude Code
  (or other agent) session is working on in the workspace's Agent Status
  list. Auto-detects branch + worktree via `git rev-parse`. Pairs with
  the `agent_session_*` MCP ops added in the Ano monorepo on the same
  day.
- `ano session enable|disable|status` — manage the local opt-in flag at
  `~/.config/ano/settings.json` (peer to `credentials.json`). Three
  states: `unset` (default — discovery line on stderr, no posts),
  `enabled` (post + print `session_id=<uuid>` to stdout), `disabled`
  (silent off-switch — no output, no posts).
- Stdout/stderr discipline is load-bearing for the paired
  `@ano-chat/skills` ano-session skill: it greps `^session_id=` on stdout
  to decide whether to make follow-up `update`/`end` calls. Without a
  session_id on stdout, the skill abandons further calls — bounding the
  attempt surface to one CLI invocation per Claude Code session for
  opted-out users.
- `ano session update|end` treat a 404 from the server as a terminal
  signal (the kill-switch flipped off, or the canonical list / session
  row was deleted). The CLI silently drops the stale cached `session_id`
  and exits 0 instead of spamming stderr with NotFoundError on every
  milestone. The next `ano session start` is a fresh attempt.

## [2.9.0] — 2026-05-05

### Added

- `ano integrations connect <app>` — authorize a third-party service
  (Linear, GitHub, Gmail, Notion, HubSpot, PostHog, etc.) for use in
  automations. Mints a Pipedream Connect URL and prints it as a clickable
  hyperlink (OSC 8). After OAuth completes, the connection is persisted
  server-side and is usable by `pipedream_run` automation actions.
  Requires server commit including the `request_connection` op (Ano
  monorepo PR shipping the same day).

## [2.2.0] — 2026-04-29

### Added

- `ano auth login --print-workspaces` — runs OAuth, caches the access
  token to `~/.config/ano/.session` (mode 0o600, 5-minute TTL), prints
  workspace memberships as a single JSON line on stdout, and exits without
  minting a key. Pair with `ano auth complete` to finish the install.
- `ano auth complete --workspace-id <id>` — reads the cached token, mints
  a CLI key for the picked workspace, saves the profile, deletes the
  cached token. Designed for non-TTY orchestrators (Claude Code, scripts,
  embedded UIs) that want to render their own workspace picker without
  re-running OAuth.

### Notes

- Existing `ano auth login` flow is unchanged. TTY users still get the
  interactive workspace picker.
- `--print-workspaces` is incompatible with `--key` / `ANO_API_KEY` —
  those skip OAuth entirely.
- See `LeoNilsson/ano-skills` v0.4.0 for the orchestration pattern.

## [2.1.0]

### Added

- OAuth login flow via `ano auth login` (no `--key` required).
- WorkOS AuthKit integration with loopback callback on port 41729.
- `--profile`, `--workspace-id`, `--client-id`, `--port` flags on
  `auth login`.
