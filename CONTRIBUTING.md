# Contributing

Thanks for working on the Ano CLI. This repo is public, but the CLI talks to
real workspaces, so keep changes small, tested, and easy to audit.

## Local Setup

```bash
npm install
npm run typecheck
npm test
npm run build
```

The CLI source is TypeScript in `src/`. The published package ships built files
from `dist/`; do not edit generated output by hand.

## Before Opening a PR

Run the checks that match your change:

```bash
npm run typecheck
npm test
npm run build
npm run surface:check
```

If you add, remove, or rename a command or flag, update the public surface
snapshot:

```bash
npm run surface:update
```

For changes that affect the daemon, Zero reads, auth, or HTTP behavior, include
targeted tests. Prefer a small regression test over broad snapshot churn.

## Production Safety

Treat production as read-only unless the task explicitly requires a write and
you have a safe workspace.

Safe commands include:

```bash
ano daemon status --json
ano dev smoke --no-write --json
ano channels list --json -w <workspace-id>
ano users list --json -w <workspace-id>
ano messages read --channel <channel-id> --json
ano tables list --json -w <workspace-id>
```

Do not use raw `curl` against the API for CLI work. The CLI is the auth boundary
and owns profile resolution, endpoint selection, retries, and output shape.

## Code Style

- Keep command modules small and explicit.
- Use structured parsers and typed helpers instead of ad hoc string handling.
- Prefer the daemon/Zero read path when it preserves behavior.
- Fall back to REST on daemon or Zero misses; do not surface replica internals as
  user-facing failures.
- Keep comments where they explain protocol, safety, or non-obvious tradeoffs.
  Remove comments that only restate the next line of code.

## Release Notes

Update `CHANGELOG.md` for user-visible changes. Keep entries factual: what
changed, why it matters, and any migration notes.
