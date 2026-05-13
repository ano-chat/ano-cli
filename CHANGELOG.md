# Changelog

All notable changes to the `ano` CLI are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/).

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
