---
name: ano
description: |
  CLI for Ano team communication. Full coverage: channels, messages, DMs, users,
  workspaces, search, real-time streaming, and service management.
  Use for ANY Ano question or action.
triggers:
  # Direct invocations
  - ano
  - /ano
  # Resource actions
  - ano channel
  - ano message
  - ano chat
  - ano dm
  - ano user
  - ano workspace
  # Common actions
  - post to ano
  - send message
  - send dm
  - read messages
  - search messages
  - list channels
  - list users
  # Real-time
  - ano connect
  - ano bridge
  - ano stream
  - start bridge
  - connect to ano
  # Setup
  - ano setup
  - ano doctor
  - ano auth
  # Search and discovery
  - search ano
  - find in ano
  - check ano
  - look up ano
  # Questions
  - how do I ano
  - what's in ano
  - can I ano
  # My work
  - my channels
  - my messages
  - my workspace
  # URLs
  - ano.dev
  - api.ano.dev
  - api-staging.ano.dev
  # Keys
  - ano_cwk_
  - ano_usr_
invocable: true
argument-hint: "[command] [args...]"
---

# /ano — Ano CLI Agent Skill

Full CLI coverage: channels, messages, DMs, users, workspaces, search, real-time
streaming (SSE), persistent service management, and agent setup.

## Agent Invariants

**MUST follow these rules:**

1. **Always use `--json` for machine-readable output** — returns `{ok, data, breadcrumbs, meta}` envelope. Use `--md` only when presenting results to a human.
2. **Breadcrumbs are navigation** — every `--json` response includes a `breadcrumbs` array with suggested next commands. Follow them.
3. **Authenticate first** — `ano auth login --key <key>` or pass `--key` / set `ANO_API_KEY` env.
4. **Rate limit: 60 requests/minute** — batch reads instead of per-message fetches. If you hit 429, wait and retry.
5. **Reply in threads** to keep channels clean — use `--thread <message_id>`.
6. **Content supports markdown** — messages accept markdown formatting.
7. **@mentions use user IDs** — get IDs from `ano users list --json`, then use `--mention <id>`.
8. **Exit codes are typed** — check exit code to determine error category (see Exit Codes below).
9. **Use `ano doctor` to diagnose** — before escalating connectivity or auth issues.
10. **Never read credentials** — `~/.config/ano/credentials.json` contains secrets. Use `ano auth status` instead.

## Output Modes

| Goal | Flag | Format |
|------|------|--------|
| Agent processing | `--json` | JSON envelope: `{ok, data, breadcrumbs, meta}` |
| Show to human | `--md` / `-m` | GFM tables with "Next steps" section |
| Headless/scripting | `--quiet` / `--agent` | Raw JSON data only, no envelope |
| Default (TTY) | (none) | Styled with ANSI colors |

Always pass `--json` explicitly when processing data. Use `--md` when composing reports.

## CLI Introspection

Navigate unfamiliar commands with `--help --agent`:

```bash
ano channels list --help --agent
```

Returns structured JSON:

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

Walk the tree: start at `ano --help --agent` for top-level commands, then drill into
any subcommand. For the full catalog: `ano commands --json`.

## Quick Reference

| Task | Command |
|------|---------|
| Authenticate | `ano auth login --key <key>` |
| Check auth | `ano auth status` |
| Remove credentials | `ano auth logout` |
| List workspaces | `ano workspaces list --json` |
| List channels | `ano channels list --json` |
| List users | `ano users list --json` |
| Read messages | `ano messages read --channel <id> --json` |
| Read messages (limited) | `ano messages read --channel <id> --limit 10 --json` |
| Send message | `ano messages send "Hello" --channel <id> --json` |
| Reply in thread | `ano messages send "Reply" --channel <id> --thread <id> --json` |
| Send with @mention | `ano messages send "Hey" --channel <id> --mention <user_id> --json` |
| Search messages | `ano messages search "query" --json` |
| Search (limited) | `ano messages search "query" --limit 5 --json` |
| Send DM (by name) | `ano dm send "Hey" --to "Jane" --json` |
| Send DM (by email) | `ano dm send "Hey" --email jane@co.com --json` |
| Send DM (by ID) | `ano dm send "Hey" --user-id <id> --json` |
| Start SSE bridge | `ano connect --key <key>` |
| Bridge with agent mode | `ano connect --key <key> --openclaw <url>` |
| Bridge with health | `ano connect --key <key> --health-port 8080` |
| Bridge with webhook | `ano connect --key <key> --webhook <url>` |
| Install as service | `ano connect install-service --key <key>` |
| Remove service | `ano connect uninstall-service --workspace <name>` |
| Run diagnostics | `ano doctor --json` |
| Show URL content | `ano show <url> --json` |
| Full command catalog | `ano commands --json` |
| Setup for Claude | `ano setup claude` |
| Setup for OpenClaw | `ano setup openclaw` |

## Decision Trees

### Finding Content

```
Need to find something?
├── Know the channel? → ano messages read --channel <id> --json
├── Need to search? → ano messages search "query" --json
├── Which channels exist? → ano channels list --json
├── Who's in the workspace? → ano users list --json
├── Have a URL? → ano show <url> --json
└── Multiple workspaces? → ano workspaces list --json
```

### Sending Content

```
Want to send something?
├── To a channel → ano messages send "text" --channel <id> --json
├── Reply in thread → ano messages send "text" --channel <id> --thread <id> --json
├── DM someone → ano dm send "text" --to "Name" --json
└── With @mention → ano messages send "text" --channel <id> --mention <user_id> --json
```

### Setting Up an Agent

```
Connect an agent to Ano?
├── Have API key?
│   ├── Yes → ano auth login --key <key>
│   └── No → Get one from Ano workspace settings
├── One-off commands → Use ano messages/channels/users directly
├── Persistent bridge → ano connect install-service --key <key>
├── OpenClaw agent → ano connect --key <key> --openclaw <url>
└── Diagnose issues → ano doctor --json
```

## Common Workflows

### Read a Channel and Respond

```bash
# 1. Find channels
ano channels list --json

# 2. Read recent messages
ano messages read --channel <channel_id> --limit 20 --json

# 3. Send a response
ano messages send "Here's what I found..." --channel <channel_id> --json
```

### Search for Context Before Responding

```bash
# 1. Search for relevant messages
ano messages search "deployment issue" --json

# 2. Read full channel for context
ano messages read --channel <channel_id> --limit 50 --json

# 3. Respond in the right thread
ano messages send "Based on the earlier discussion..." --channel <channel_id> --thread <msg_id> --json
```

### Set Up Persistent Bridge with OpenClaw

```bash
# 1. Verify credentials
ano doctor --json

# 2. Install as a persistent service with agent mode
ano connect install-service \
  --key ano_cwk_... \
  --openclaw http://localhost:3000 \
  --health-port 8080

# 3. Verify health
curl http://127.0.0.1:8080/healthz
```

### Monitor Real-Time Events

```bash
# Start bridge — events stream as JSON lines on stdout
ano connect --key ano_cwk_...

# Example output:
# {"type":"connected","workspace":"Acme","channels":5,"members":12}
# {"type":"message","channel_id":"...","content":"Hello","sender_name":"Jane"}
# {"type":"dm","content":"Hey agent","sender_name":"Bob"}
```

### Send Commands via Control Port

```bash
# Start bridge with control port
ano connect --key ano_cwk_... --control-port 9000

# Send message via HTTP
curl -X POST http://127.0.0.1:9000 \
  -H "Content-Type: application/json" \
  -d '{"action":"send_message","channel_id":"...","content":"Hello from API"}'

# Send typing indicator
curl -X POST http://127.0.0.1:9000 \
  -H "Content-Type: application/json" \
  -d '{"action":"typing","channel_id":"..."}'
```

## Error Handling

### Exit Codes

| Code | Name | Meaning | Fix |
|------|------|---------|-----|
| 0 | OK | Success | — |
| 1 | USAGE | Bad args or flags | Check `ano <cmd> --help` |
| 2 | NOT_FOUND | Resource doesn't exist | Verify ID/URL |
| 3 | AUTH | Invalid or missing key | `ano auth login --key <key>` |
| 4 | FORBIDDEN | Insufficient permissions | Check API key scopes |
| 5 | RATE_LIMIT | 60/min exceeded | Wait and retry |
| 6 | NETWORK | Connection failed | Check endpoint, run `ano doctor` |
| 7 | API_ERROR | Server error | Retry, check Ano status |

### Error Response Format (--json)

```json
{
  "ok": false,
  "error": "Invalid or expired API key",
  "code": 3,
  "hint": "Run \"ano auth login\" or pass --key"
}
```

### Error Decision Tree

```
Got an error?
├── Exit 1 (USAGE) → Check command syntax: ano <cmd> --help
├── Exit 3 (AUTH) → Run: ano auth login --key <key>
├── Exit 4 (FORBIDDEN) → Key lacks required scope
├── Exit 5 (RATE_LIMIT) → Wait, then retry
├── Exit 6 (NETWORK) → Run: ano doctor --json
└── Exit 7 (API_ERROR) → Retry; if persistent, check Ano status
```

## Configuration

```
~/.config/ano/
├── credentials.json     # API keys (profiles)
└── config.json          # Global defaults

.ano/                    # Per-project config (git-committed)
└── config.json          # Project-level overrides
```

### Auth Resolution Chain

1. `--key` flag (highest priority)
2. `ANO_API_KEY` environment variable
3. `.ano/config.json` (project-level)
4. `~/.config/ano/credentials.json` (global, default profile)

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ANO_API_KEY` | API key (alternative to --key) |
| `ANO_ENDPOINT` | API endpoint (default: https://api.ano.dev) |
| `ANO_WORKSPACE_ID` | Default workspace ID |
| `NO_COLOR` | Disable ANSI colors |

## Rate Limiting

- **60 requests per minute** per API key (sliding window)
- Rate limit headers returned: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- The CLI retries automatically on 429 with exponential backoff
- **Best practice:** Batch reads. Use `--limit` to get what you need in one call instead of many small requests.

## Event Types (SSE Bridge)

When using `ano connect`, events stream as JSON lines:

| Type | Trigger | Key Fields |
|------|---------|------------|
| `message` | New channel message | channel_id, content, sender_name, mentions |
| `thread_reply` | Reply in thread | channel_id, thread_id, content, sender_name, parent |
| `dm` | Direct message | channel_id, content, sender_name |
| `reaction` | Emoji reaction | message_id, emoji, sender_name |
| `channel_added` | User added to channel | channel_id, user_id |
| `channel_removed` | User removed from channel | channel_id, user_id |

### Agent Mode Behavior (--openclaw)

When `--openclaw <url>` is set, the bridge automatically:
- Responds to all DMs
- Responds to all thread replies in monitored channels
- Responds to @mentions of the agent's user
- Shows typing indicator while processing
- Does NOT respond to its own messages

## Integration Patterns

### Claude Code

```bash
ano setup claude           # Install skill to .claude/skills/
ano setup claude --global  # Install to ~/.claude/skills/
```

The skill file teaches Claude Code all `ano` commands, output formats, and workflows.

### OpenClaw

```bash
# Configure and test
ano setup openclaw --openclaw-url http://localhost:3000

# Start persistent bridge
ano connect install-service \
  --key ano_cwk_... \
  --openclaw http://localhost:3000 \
  --openclaw-token <token> \
  --health-port 8080
```

### Webhook Mode

```bash
ano connect --key ano_cwk_... --webhook https://your-server.com/events --webhook-secret mysecret
```

Events POSTed as JSON with `X-Ano-Secret` header.

### stdin/stdout Protocol

When running `ano connect`, commands are sent as JSON on stdin:

```json
{"action": "send_message", "channel_id": "...", "content": "Hello"}
{"action": "typing", "channel_id": "..."}
{"action": "send_dm", "recipient_name": "Jane", "content": "Hey"}
```

Events stream as JSON lines on stdout.

## Message Formatting

- **Content supports markdown** — bold, italic, lists, code blocks, links
- **@mentions** — pass user IDs via `--mention <id>` flag
- **Thread replies** — use `--thread <message_id>` to reply in a thread
- **Keep channels clean** — always reply in threads when responding to a specific message

## Breadcrumb Format

Every `--json` response includes a `breadcrumbs` array:

```json
{
  "breadcrumbs": [
    {
      "action": "read_messages",
      "cmd": "ano messages read --channel <id>",
      "description": "Read messages from a channel"
    }
  ]
}
```

- `action` — machine-readable action identifier
- `cmd` — runnable command (may include `<placeholder>` tokens to fill in)
- `description` — human-readable description of what the command does

Always follow breadcrumbs when navigating the Ano workspace — they suggest the most
relevant next steps based on what you just did.

## Learn More

- CLI repo: https://github.com/LeoNilsson/ano-cli
- Ano: https://ano.dev
- API: https://api.ano.dev
