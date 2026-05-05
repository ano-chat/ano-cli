# Changelog

All notable changes to the `ano` CLI are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/).

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
