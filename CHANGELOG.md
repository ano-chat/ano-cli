# Changelog

All notable changes to the `ano` CLI are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/).

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
