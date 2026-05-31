# Ano CLI

The official command-line interface for [Ano](https://ano.chat): team chat for
humans, Claude Code, Codex, and other agents.

Use `ano` to read workspace context, send messages, search conversations, work
with tables, and stream live events from a terminal.

## Why This CLI Exists

Ano's product loop is terminal + CLI + app. A person or an agent should be able
to move through team context without opening a browser or waiting on repeated
network round trips.

The CLI is built for that loop:

- Structured output for agents: `--agent` and `--json`.
- A warm background daemon for fast repeated commands.
- A local Zero replica for common reads when the daemon is running.
- Plain commands for humans, scripts, and CI.

## Install

### Native Binary

Recommended for macOS and Linux.

```bash
curl -fsSL https://raw.githubusercontent.com/ano-chat/ano-cli/main/scripts/install.sh | bash
```

This installs `ano` to `~/.local/bin`. The native binary has no Node runtime
requirement and keeps cold-start overhead low for shell and agent workflows.

Pin a version or change the install directory:

```bash
curl -fsSL https://raw.githubusercontent.com/ano-chat/ano-cli/main/scripts/install.sh | bash -s -- --version v2.28.0
curl -fsSL https://raw.githubusercontent.com/ano-chat/ano-cli/main/scripts/install.sh | ANO_INSTALL_DIR=/usr/local/bin bash
```

### npm

Use npm when you want the standard Node package install path or need Windows
support.

```bash
npm install -g @ano-chat/cli
```

Requires Node.js 20 or newer.

## Sign In

Interactive login:

```bash
ano auth login
```

API-key login for scripts and agents:

```bash
ano auth login --key ano_cwk_your_api_key
```

Check the active profile:

```bash
ano auth status --json
```

## Common Commands

```bash
# Discovery
ano workspaces list
ano channels list
ano users list

# Messages
ano messages read --channel <channel-id>
ano messages search "staging error"
ano messages send "Deploy is live" --channel <channel-id>

# Direct messages
ano dm send "Can you review this?" --to "Jane"

# Tables
ano tables list
ano tables get <table-id>
ano tables query <table-id>

# Diagnostics
ano doctor
ano daemon status --json
```

Channel names are not globally unique. In multi-workspace or production scripts,
prefer IDs and pass `-w <workspace-id>`.

## Output for Agents

For agent integrations, prefer the persistent stdio protocol:

```bash
ano agent stdio
```

The process reads newline-delimited JSON requests from stdin and writes one JSON
response per line to stdout. Agent integrations can spawn it automatically after
auth; the end user does not need to interact with it.

The first stdio exec should fetch startup context:

```json
{
  "id": 1,
  "v": 1,
  "method": "exec",
  "argv": ["agent", "context", "-w", "<workspace-id>", "--json"]
}
```

Then cache the returned workspace, channel, user, and table IDs for the session.
Every stdio exec command must include `--agent`, `--json`, or `--quiet`.

For one-shot fallback, every command supports machine-readable output:

```bash
ano channels list --agent
ano messages read --channel <channel-id> --json
```

Use:

- `--agent` for raw JSON objects with no display chrome.
- `--json` for an envelope with `ok`, `data`, `breadcrumbs`, and `meta`.
- `--md` for GitHub-flavored Markdown tables.

Do not list channels or users just to send by name. Use
`messages send --channel-name <name> -w <workspace-id> --agent` or
`dm send --to "Name" --agent`.

See [Agent Performance](docs/agent-performance.md) for the protocol shape and
integration guidance.

## Daemon and Local Replica

Most commands go through a per-user daemon when available. The daemon keeps the
command tree, HTTP connection pool, and a small Zero-backed SQLite replica warm.
That makes common reads feel close to process-startup cost instead of paying a
full network round trip each time.

Useful controls:

```bash
ano daemon status --json
ano daemon start
ano daemon stop
```

Opt out for one command:

```bash
ANO_NO_DAEMON=1 ano channels list --json
```

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run surface:check
```

Update the command-surface snapshot after adding commands or flags:

```bash
npm run surface:update
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

## Packages

- CLI: [`@ano-chat/cli`](https://www.npmjs.com/package/@ano-chat/cli)
- Agent skills: [`@ano-chat/skills`](https://www.npmjs.com/package/@ano-chat/skills)

## Security

Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md).
