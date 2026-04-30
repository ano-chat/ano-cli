# Ano CLI

The official command-line interface for [Ano](https://ano.dev). Built for AI agents first, great for humans too.

Read messages, send replies, search conversations, stream real-time events, and manage workspaces — all from the terminal or through any AI agent.

```bash
npm install -g @ano-chat/cli
```

## Quick Start

```bash
# Authenticate (browser-based — opens your default browser)
ano auth login

# …or paste an API key directly
ano auth login --key ano_cwk_your_api_key

# Explore your workspace
ano channels list
ano users list

# Read and respond
ano messages read --channel general
ano messages send "Deployed v2.1 to staging" --channel engineering
ano messages search "deployment failed"

# Send a DM
ano dm send "Can you review PR #42?" --to "Jane"
```

### Non-TTY orchestration (Claude Code, scripts)

When the CLI is driven by an orchestrator without a real TTY, the
interactive workspace picker can't run. Use the two-step flow instead
— the orchestrator renders its own picker between the two calls:

```bash
# Step 1: run OAuth, cache the access token, print available workspaces
# as a single JSON line on stdout (the orchestrator parses this).
ano auth login --print-workspaces

# Step 2: orchestrator renders a picker, captures user's choice, then:
ano auth complete --workspace-id <picked-id>
```

The cached token at `~/.config/ano/.session` has a 5-minute TTL and is
deleted automatically after `auth complete` succeeds. See
[`packages/skills/skills/ano-cli/SKILL.md`](packages/skills/skills/ano-cli/SKILL.md)
for the full agent-orchestration recipe.

## Why Ano CLI?

**Agent-first design.** Every command returns structured JSON with breadcrumbs that tell your agent what to do next. Built-in `--help --agent` gives machine-readable command discovery. Your AI agent can navigate the entire Ano workspace without reading docs.

**Real-time native.** Not just request/response — `ano connect` opens a persistent SSE stream for live events. Messages, DMs, reactions, and channel changes flow in real-time. Install as a system service for always-on agent presence.

**Zero config.** One API key. One command. Works immediately.

## Installation

```bash
# npm (recommended)
npm install -g @ano-chat/cli

# or run without installing
npx @ano-chat/cli channels list --key ano_cwk_...
```

Requires Node.js 18+.

## Commands

### Messages

```bash
ano messages read --channel <id>                       # Read recent messages
ano messages read --channel <id> --limit 50            # Read more
ano messages send "Hello team" --channel <id>          # Send a message
ano messages send "Fix applied" --channel <id> --thread <msg_id>  # Reply in thread
ano messages send "Hey @jane" --channel <id> --mention <user_id>  # @mention
ano messages search "authentication bug"               # Full-text search
```

### Direct Messages

```bash
ano dm send "Quick question" --to "Jane Smith"         # By name
ano dm send "See this PR" --email jane@company.com     # By email
ano dm send "Approved" --user-id <id>                  # By ID
```

### Channels & Users

```bash
ano channels list         # All channels you can access
ano users list            # All workspace members
ano workspaces list       # Your workspaces
```

### Real-Time Bridge

`ano connect` opens a persistent SSE connection. Events stream as JSON lines on stdout — your agent reads them and responds via stdin commands or the control port.

```bash
# Basic bridge — events on stdout, commands on stdin
ano connect

# With OpenClaw agent mode — auto-responds to mentions and DMs
ano connect --openclaw http://localhost:3000

# With health monitoring
ano connect --health-port 8080

# Install as a persistent system service (survives reboots)
ano connect install-service --key ano_cwk_... --health-port 8080

# Remove the service
ano connect uninstall-service --workspace "My Workspace"
```

**Event types:** `message`, `thread_reply`, `dm`, `reaction`, `channel_added`, `channel_removed`

**stdin commands:**

```json
{"action": "send_message", "channel_id": "...", "content": "Hello"}
{"action": "send_dm", "recipient_name": "Jane", "content": "Hey"}
{"action": "typing", "channel_id": "..."}
```

### Diagnostics

```bash
ano doctor          # Check auth, connectivity, workspace access
ano auth status     # Show current authentication
ano show <url>      # Display content from an Ano URL
```

### Agent Setup

```bash
ano setup claude              # Install skill for Claude Code
ano setup claude --global     # Install globally
ano setup openclaw            # Configure OpenClaw integration
```

## Output Formats

Every command supports four output modes:

```bash
ano channels list              # Styled for humans (default in TTY)
ano channels list --json       # JSON envelope with breadcrumbs
ano channels list --md         # GFM markdown tables
ano channels list --quiet      # Raw JSON, one object per line
```

### JSON Envelope

The `--json` format wraps every response in a consistent envelope:

```json
{
  "ok": true,
  "data": [
    {
      "id": "ch_1",
      "name": "general",
      "type": "channel",
      "topic": "General discussion"
    }
  ],
  "breadcrumbs": [
    {
      "action": "read_messages",
      "cmd": "ano messages read --channel ch_1",
      "description": "Read messages from a channel"
    },
    {
      "action": "send_message",
      "cmd": "ano messages send --channel ch_1 \"Hello\"",
      "description": "Send a message to a channel"
    }
  ],
  "meta": {
    "timestamp": "2026-03-27T10:00:00.000Z",
    "version": "0.1.0"
  }
}
```

**Breadcrumbs** are the key agent feature — every response tells your agent what to do next.

## Agent Integration

### Structured Command Discovery

Any agent can explore the full CLI without reading documentation:

```bash
# Get structured JSON for any command
ano channels list --help --agent

# Get the complete command catalog
ano commands --json
```

`--help --agent` returns:

```json
{
  "command": "ano channels list",
  "path": ["ano", "channels", "list"],
  "description": "List channels in the workspace",
  "args": [],
  "flags": [],
  "subcommands": []
}
```

### Skill File

The repo includes a comprehensive [SKILL.md](packages/skills/skills/ano-cli/SKILL.md) that teaches any AI agent how to use every command, with decision trees, workflows, error handling patterns, and integration examples. It ships as part of the [`@ano-chat/skills`](https://www.npmjs.com/package/@ano-chat/skills) Claude Code plugin.

Install it for your agent:

```bash
ano setup claude     # Claude Code
ano setup openclaw   # OpenClaw
```

Or point your agent at `packages/skills/skills/ano-cli/SKILL.md` directly.

### OpenClaw Agent Mode

Connect an OpenClaw agent to your Ano workspace with a single command:

```bash
ano connect \
  --key ano_cwk_... \
  --openclaw http://localhost:3000 \
  --openclaw-token <token> \
  --health-port 8080
```

The agent automatically responds to @mentions, DMs, and thread replies.

## Authentication

Auth resolves through a priority chain:

| Priority | Source                           | Example                               |
| -------- | -------------------------------- | ------------------------------------- |
| 1        | `--key` flag                     | `ano channels list --key ano_cwk_...` |
| 2        | `ANO_API_KEY` env                | `export ANO_API_KEY=ano_cwk_...`      |
| 3        | `.ano/config.json`               | Project-level config                  |
| 4        | `~/.config/ano/credentials.json` | Global config (via `ano auth login`)  |

```bash
# Save credentials (validates the key first)
ano auth login --key ano_cwk_your_key

# Check what's configured
ano auth status

# Remove credentials
ano auth logout
```

## Exit Codes

Every error has a typed exit code for programmatic handling:

| Code | Name       | Meaning                     |
| ---- | ---------- | --------------------------- |
| 0    | OK         | Success                     |
| 1    | USAGE      | Bad arguments or flags      |
| 2    | NOT_FOUND  | Resource doesn't exist      |
| 3    | AUTH       | Invalid or missing API key  |
| 4    | FORBIDDEN  | Insufficient permissions    |
| 5    | RATE_LIMIT | 60 requests/minute exceeded |
| 6    | NETWORK    | Connection failed           |
| 7    | API_ERROR  | Server error                |

Errors in `--json` mode return structured objects:

```json
{
  "ok": false,
  "error": "Invalid or expired API key",
  "code": 3,
  "hint": "Run \"ano auth login\" or pass --key"
}
```

## Binaries

This package installs two binaries:

- **`ano`** — the interactive CLI (messages, channels, DMs, search, auth). Use this for day-to-day work.
- **`ano-bridge`** — standalone bridge daemon for connecting external AI agents (OpenClaw, webhooks) to your workspace. Equivalent to `ano connect` but as a single focused binary, convenient for background services and process managers.

> Previously published as `ano-connect` (with an `ano-connect` binary). Those names are deprecated — use `@ano-chat/cli` and `ano-bridge` for new work.

## Development

```bash
git clone https://github.com/LeoNilsson/ano-cli.git
cd ano-cli
npm install
npm run build          # Build with tsup
npm run typecheck      # TypeScript check
npm run test           # Run tests
npm run surface:update # Regenerate command surface snapshot
npm run surface:check  # Check for breaking changes
```

## License

[MIT](LICENSE)
