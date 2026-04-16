---
name: ano-cli
description: |
  CLI for Ano team communication. Channels, messages, DMs, users, workspaces,
  search, real-time streaming, and agent setup. Use for ANY Ano action.
triggers:
  - send a message
  - send message to
  - post in channel
  - reply in thread
  - read messages
  - read channel
  - search messages
  - find messages
  - send dm
  - send direct message
  - list channels
  - show channels
  - list users
  - list members
  - list workspaces
  - ano login
  - ano auth
  - ano connect
  - ano setup
  - ano doctor
  - ano show
  - check ano
  - notify team
  - notify channel
  - update the team
  - post an update
  - ano.dev
  - api.ano.dev
  - ano_cwk_
invocable: true
argument-hint: "[command] [args...]"
---

# Ano CLI — Agent Skill

CLI for Ano team communication. Read/send messages, list channels and members,
search conversations, stream real-time events, and manage agent integrations.

## Agent Invariants

1. **Always use `--agent` or `--json` output.** Never parse styled TTY output.
   Use `--agent` for raw JSON; `--json` for envelope with breadcrumbs.
2. **Never fabricate IDs.** Channel/user/message IDs are UUIDs. Get them from
   `ano channels list --agent` or `ano users list --agent` first.
3. **Resolve by name before acting.** "Post in #general" → list channels, find
   the ID, then send. "DM Leo" → list users, find the ID, then send.
4. **Respect rate limits.** 60 requests/minute. Exit code 5 = rate limited.
   Wait 10+ seconds before retrying.
5. **Check exit codes.** Non-zero = failure. Parse the error envelope.
6. **Never expose API keys.** Don't log or include `ano_cwk_*` keys in output.
7. **Content supports markdown.** Bold, links, code blocks, lists all work.
8. **Reply in threads** to keep channels clean. Use `--thread <message_id>`.
9. **Follow breadcrumbs.** JSON responses include suggested next commands.
10. **Run `ano doctor`** before escalating connectivity issues.

## Output Modes

| Flag      | Format                                    | When to use               |
| --------- | ----------------------------------------- | ------------------------- |
| `--agent` | Raw JSON (one object per line)            | Default for agents        |
| `--json`  | Envelope: `{ok, data, breadcrumbs, meta}` | When you need breadcrumbs |
| `--md`    | GFM markdown tables                       | Presenting to humans      |
| `--quiet` | Same as `--agent`                         | Scripting                 |
| (none)    | Styled with colors                        | Interactive TTY           |

### JSON envelope (`--json`)

```json
{
  "ok": true,
  "data": [...],
  "breadcrumbs": [
    {"action": "read_messages", "cmd": "ano messages read --channel <id>", "description": "Read messages"}
  ],
  "meta": {"timestamp": "...", "version": "0.1.0"}
}
```

### Error output

```json
{
  "ok": false,
  "error": "Invalid or expired API key",
  "code": 3,
  "hint": "Run \"ano auth login\" or pass --key"
}
```

## CLI Introspection

```bash
ano channels list --help --agent    # Structured JSON for one command
ano commands --json                 # Full command catalog
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

## Quick Reference

| Task                | Command                                                               |
| ------------------- | --------------------------------------------------------------------- |
| **Auth**            |                                                                       |
| Save API key        | `ano auth login --key <key>`                                          |
| Check auth          | `ano auth status --agent`                                             |
| Remove credentials  | `ano auth logout`                                                     |
| **Read**            |                                                                       |
| List channels       | `ano channels list --agent`                                           |
| List users          | `ano users list --agent`                                              |
| List workspaces     | `ano workspaces list --agent`                                         |
| Read messages       | `ano messages read --channel <id> --agent`                            |
| Read (limited)      | `ano messages read --channel <id> --limit 10 --agent`                 |
| Search messages     | `ano messages search "query" --agent`                                 |
| Search (limited)    | `ano messages search "query" --limit 5 --agent`                       |
| Show URL content    | `ano show <url> --agent`                                              |
| **Write**           |                                                                       |
| Send message        | `ano messages send "text" --channel <id> --agent`                     |
| Reply in thread     | `ano messages send "text" --channel <id> --thread <msg_id> --agent`   |
| Send with @mention  | `ano messages send "text" --channel <id> --mention <user_id> --agent` |
| Send DM (by name)   | `ano dm send "text" --to "Name" --agent`                              |
| Send DM (by email)  | `ano dm send "text" --email user@co.com --agent`                      |
| Send DM (by ID)     | `ano dm send "text" --user-id <id> --agent`                           |
| **Real-time**       |                                                                       |
| Start SSE bridge    | `ano connect`                                                         |
| Bridge + agent mode | `ano connect --openclaw <url>`                                        |
| Bridge + health     | `ano connect --health-port 8080`                                      |
| Install service     | `ano connect install-service`                                         |
| Remove service      | `ano connect uninstall-service --workspace <name>`                    |
| **Diagnostics**     |                                                                       |
| Full diagnostics    | `ano doctor --agent`                                                  |
| Command catalog     | `ano commands --json`                                                 |
| Setup Claude        | `ano setup claude`                                                    |
| Setup OpenClaw      | `ano setup openclaw`                                                  |

## Decision Trees

### Finding Content

```
Need to find something?
├── Know the channel? → ano messages read --channel <id> --agent
├── Need to search? → ano messages search "query" --agent
├── Which channels exist? → ano channels list --agent
├── Who's in the workspace? → ano users list --agent
├── Have a URL? → ano show <url> --agent
└── Multiple workspaces? → ano workspaces list --agent
```

### Sending Content

```
Want to send something?
├── To a channel → ano messages send "text" --channel <id> --agent
├── Reply in thread → add --thread <msg_id>
├── With @mention → add --mention <user_id>
└── DM someone → ano dm send "text" --to "Name" --agent
```

### Setting Up Agent Access

```
├── Have API key? → ano auth login --key <key>
├── One-off commands → use ano messages/channels/users directly
├── Persistent bridge → ano connect install-service
├── OpenClaw agent → ano connect --openclaw <url>
└── Diagnose issues → ano doctor --agent
```

## Common Workflows

### Read a channel and reply

```bash
channels=$(ano channels list --agent)
# Parse to find channel ID for "general"
messages=$(ano messages read --channel "$CHANNEL_ID" --limit 20 --agent)
ano messages send "Here's my analysis..." --channel "$CHANNEL_ID" --agent
```

### Search, then reply in thread

```bash
results=$(ano messages search "deployment issue" --agent)
# Extract channel_id and message_id from results
ano messages read --channel "$CHANNEL_ID" --limit 50 --agent
ano messages send "Fix applied" --channel "$CHANNEL_ID" --thread "$MSG_ID" --agent
```

### DM with user lookup

```bash
users=$(ano users list --agent)
# Find user ID for "Jane"
ano dm send "Can you review PR #42?" --to "Jane" --agent
```

### Real-time bridge with OpenClaw

```bash
# Start persistent agent bridge
ano connect install-service \
  --key ano_cwk_... \
  --openclaw http://localhost:3000 \
  --health-port 8080

# Verify
curl http://127.0.0.1:8080/healthz
```

### stdin/stdout bridge protocol

Events stream as JSON lines on stdout:

```json
{"type":"connected","workspace":"Acme","channels":5,"members":12}
{"type":"message","channel_id":"...","content":"Hello","sender_name":"Jane"}
{"type":"dm","content":"Hey agent","sender_name":"Bob"}
```

Send commands on stdin:

```json
{"action":"send_message","channel_id":"...","content":"Hello"}
{"action":"send_dm","recipient_name":"Jane","content":"Hey"}
{"action":"typing","channel_id":"..."}
```

## Exit Codes

| Code | Name       | Meaning             | Fix                          |
| ---- | ---------- | ------------------- | ---------------------------- |
| 0    | OK         | Success             | —                            |
| 1    | USAGE      | Bad arguments       | `ano <cmd> --help`           |
| 2    | NOT_FOUND  | Resource missing    | Verify ID/URL                |
| 3    | AUTH       | Invalid/missing key | `ano auth login --key <key>` |
| 4    | FORBIDDEN  | No permission       | Check key scopes             |
| 5    | RATE_LIMIT | 60/min exceeded     | Wait 10s, retry              |
| 6    | NETWORK    | Connection failed   | `ano doctor --agent`         |
| 7    | API_ERROR  | Server error        | Retry                        |

## Authentication

Resolution chain (highest priority first):

1. `--key` flag
2. `ANO_API_KEY` environment variable
3. `.ano/config.json` (project-level)
4. `~/.config/ano/credentials.json` (global, via `ano auth login`)

```bash
# Save credentials
ano auth login --key ano_cwk_... --endpoint https://api-staging.ano.dev

# Check
ano auth status --agent

# For non-default endpoints
ano auth login --key ano_cwk_... --endpoint https://api-staging.ano.dev --profile staging
```

## Configuration

```
~/.config/ano/
├── credentials.json    # API keys per profile
└── config.json         # Global defaults

.ano/
└── config.json         # Project-level overrides (workspace_id, endpoint)
```

| Env Variable       | Description                                 |
| ------------------ | ------------------------------------------- |
| `ANO_API_KEY`      | API key                                     |
| `ANO_ENDPOINT`     | API endpoint (default: https://api.ano.dev) |
| `ANO_WORKSPACE_ID` | Default workspace                           |
| `NO_COLOR`         | Disable ANSI colors                         |

## Event Types (SSE Bridge)

| Type              | Trigger         | Key Fields                                 |
| ----------------- | --------------- | ------------------------------------------ |
| `message`         | Channel message | channel_id, content, sender_name, mentions |
| `thread_reply`    | Thread reply    | channel_id, thread_id, content, parent     |
| `dm`              | Direct message  | channel_id, content, sender_name           |
| `reaction`        | Emoji reaction  | message_id, emoji, sender_name             |
| `channel_added`   | Joined channel  | channel_id, user_id                        |
| `channel_removed` | Left channel    | channel_id, user_id                        |

Agent mode (`--openclaw`) auto-responds to DMs, thread replies, and @mentions.

## Rate Limiting

- 60 requests/minute per API key, sliding window
- Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- CLI retries automatically on 429 with backoff
- Batch reads with `--limit` instead of many small requests
- A typical workflow (list channels + read + send) uses 3 of 60 requests

## Learn More

- CLI repo: https://github.com/LeoNilsson/ano-cli
- Ano: https://ano.dev
