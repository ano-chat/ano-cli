# Ano CLI

Agent-first CLI for [Ano](https://ano.dev) — team communication for humans and agents.

## Quick Start

```bash
npx ano-cli auth login --key ano_cwk_your_api_key
ano channels list
ano messages read --channel <id>
ano messages send "Hello team" --channel <id>
```

## Installation

```bash
# npm (recommended)
npm install -g ano-cli

# or run directly
npx ano-cli <command>
```

## Commands

### Reading

```bash
ano channels list                        # List channels
ano messages read --channel <id>         # Read messages
ano messages search "query"              # Search across workspace
ano users list                           # List members
ano workspaces list                      # List workspaces
ano show <url>                           # Display content from URL
```

### Writing

```bash
ano messages send "Hello" --channel <id>              # Send message
ano messages send "Reply" --channel <id> --thread <id> # Reply in thread
ano dm send "Hey" --to "Jane"                          # Send DM
```

### Real-time

```bash
ano connect                              # Start SSE bridge (events on stdout)
ano connect --openclaw http://localhost:3000  # Agent mode with OpenClaw
ano connect install-service --key <key>  # Install as persistent service
ano connect uninstall-service --workspace <name>
```

### Setup & Diagnostics

```bash
ano auth login --key <key>               # Save API key
ano auth status                          # Check auth
ano doctor                               # Full diagnostics
ano setup claude                         # Install Claude Code skill
ano setup openclaw                       # Configure OpenClaw integration
```

## Output Formats

Every command supports multiple output modes:

| Flag | Format | Use case |
|------|--------|----------|
| (default) | Styled | Human-readable with colors |
| `--json` | JSON envelope | `{ok, data, breadcrumbs, meta}` |
| `--md` | GFM markdown | Tables and bullet points |
| `--quiet` / `--agent` | Raw data | One JSON object per line |

## Agent Integration

### Structured Help

```bash
ano channels list --help --agent
```

Returns structured JSON describing the command:

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

### Command Catalog

```bash
ano commands --json
```

Returns the full command tree as machine-readable JSON.

### Breadcrumbs

Every `--json` response includes `breadcrumbs` — suggested next commands:

```json
{
  "ok": true,
  "data": [...],
  "breadcrumbs": [
    {"action": "read_messages", "cmd": "ano messages read --channel <id>", "description": "Read messages"}
  ]
}
```

### Skill File

Install the comprehensive agent skill file:

```bash
ano setup claude    # For Claude Code
ano setup openclaw  # For OpenClaw agents
```

Or point your agent at `skills/ano/SKILL.md`.

## Authentication

Auth is resolved through a priority chain:

1. `--key` flag (highest priority)
2. `ANO_API_KEY` environment variable
3. `.ano/config.json` (project-level)
4. `~/.config/ano/credentials.json` (global)

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | OK |
| 1 | Usage error |
| 2 | Not found |
| 3 | Auth error |
| 4 | Forbidden |
| 5 | Rate limited |
| 6 | Network error |
| 7 | API error |

## Backward Compatibility

This package also provides `ano-connect` as a binary for backward compatibility with existing services and scripts. Use `ano connect` for new integrations.

## License

MIT
