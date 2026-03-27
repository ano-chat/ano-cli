---
name: ano
description: >
  Interact with Ano team workspaces — read and send messages, list channels
  and members, search conversations, send DMs, manage real-time SSE bridges,
  and integrate with Claude Code or OpenClaw agents. All operations go through
  the `ano` CLI which wraps the Ano /mcp/* REST API.
triggers:
  # Messaging
  - send a message
  - send message to
  - post in channel
  - post to channel
  - reply in thread
  - thread reply
  - send a reply
  - read messages
  - read channel
  - check messages
  - get messages
  - fetch messages
  - show messages
  - latest messages
  - recent messages
  - message history
  - search messages
  - find messages
  - search for
  - look up message
  # DMs
  - send dm
  - send direct message
  - dm someone
  - message user
  - private message
  # Channels
  - list channels
  - show channels
  - what channels
  - which channels
  - channel list
  - find channel
  # Users / Members
  - list users
  - list members
  - show members
  - who is in
  - workspace members
  - team members
  # Workspaces
  - list workspaces
  - show workspaces
  - which workspace
  # Auth & Setup
  - ano login
  - ano auth
  - authenticate ano
  - connect to ano
  - ano connect
  - ano setup
  - install ano
  - configure ano
  - ano doctor
  - ano diagnostics
  # General
  - ano status
  - ano show
  - check ano
  - use ano
  - ano help
  - talk to team
  - communicate with team
  - notify team
  - notify channel
  - update the team
  - tell the team
  - ask the team
  - post an update
  # URLs and keys
  - ano.dev
  - api.ano.dev
  - ano_cwk_
invocable: true
argument-hint: "[command] [args...]"
---

# Ano CLI -- Agent Instruction File

You have access to the `ano` command-line tool. It lets you interact with Ano
team workspaces: reading and sending messages, listing channels and members,
searching conversations, and managing real-time event bridges.

All API operations go through `https://api.ano.dev/mcp/*` (or a custom
endpoint). Authentication uses coworker API keys prefixed `ano_cwk_`.

---

## Agent Invariants

These rules are non-negotiable. Follow them on every invocation.

1. **Always use `--agent` or `--json` output mode.** Never parse TTY-styled
   output. Prefer `--agent` for minimal JSON; use `--json` when you need
   breadcrumbs or metadata.

2. **Never fabricate IDs.** Channel IDs, user IDs, message IDs, and thread IDs
   are UUIDs. Always obtain them from a prior `ano` command (e.g.,
   `ano channels list --agent`, `ano users list --agent`).

3. **Resolve channels by name before sending.** If the user says "post in
   #general", first run `ano channels list --agent`, find the channel with
   `name == "general"`, then use its `id` in `--channel`.

4. **Resolve users by name before mentioning or DMing.** If the user says
   "DM Leo" or "mention Ruben", first run `ano users list --agent` to find
   the matching `display_name` and `id`.

5. **Respect rate limits.** The API enforces 60 requests per minute per key.
   If you receive exit code 5 (RATE_LIMIT), wait at least 10 seconds before
   retrying. Never retry in a tight loop.

6. **Check exit codes.** A non-zero exit code means the command failed. Parse
   stderr or the JSON error envelope to understand why. Do not assume success.

7. **Never expose API keys.** Do not log, print, or include `ano_cwk_*` keys
   in messages, commits, or output shown to users. Use `--key` only when
   piping to the CLI, and prefer environment variables or saved credentials.

8. **Content supports markdown.** Message content sent via `ano messages send`
   or `ano dm send` is rendered as markdown in Ano. Use `**bold**`,
   `* bullets` (not `-`), code blocks, and links as appropriate.

9. **Thread replies require `--thread`.** When replying to a thread, always
   pass `--thread <message_id>`. Omitting it sends a top-level message.

10. **Prefer `ano doctor` for diagnostics.** If any command fails with auth or
    network errors, run `ano doctor --agent` first to diagnose before
    attempting fixes.

11. **Follow breadcrumbs.** Every `--json` response includes a `breadcrumbs`
    array with suggested next commands. Use these to navigate the workspace
    efficiently.

12. **Never read credential files directly.** Use `ano auth status --agent`
    to check authentication. The file `~/.config/ano/credentials.json`
    contains secrets and must not be read or displayed.

---

## Output Modes

| Flag           | Format                              | When to use                          |
|----------------|-------------------------------------|--------------------------------------|
| `--agent`      | Raw JSON, one object per line       | Default for agents -- minimal, fast  |
| `--json` / `-j`| `{ok, data, breadcrumbs, meta}`     | When you need next-step suggestions  |
| `--md` / `-m`  | GFM tables + "Next steps" section   | When rendering for human review      |
| `--quiet` / `-q`| Same as `--agent`                  | Alias for `--agent`                  |
| *(none/TTY)*   | Styled with ANSI colors             | Never use in agent context           |

### JSON envelope structure (`--json`)

```json
{
  "ok": true,
  "data": [ ... ],
  "breadcrumbs": [
    {
      "action": "read_messages",
      "cmd": "ano messages read --channel <id>",
      "description": "Read channel messages"
    }
  ],
  "meta": {
    "timestamp": "2026-03-27T12:00:00.000Z",
    "version": "0.6.0"
  }
}
```

### Agent mode output (`--agent`)

For list commands, each item is a separate JSON line:

```
{"id":"abc-123","name":"general","type":"public","topic":"General discussion"}
{"id":"def-456","name":"engineering","type":"public","topic":"Engineering talk"}
```

For single-result commands (send, DM), one JSON object:

```
{"ok":true,"message_id":"msg-789","channel_id":"abc-123"}
```

### Error output (`--agent` / `--json`)

```json
{
  "ok": false,
  "error": "Invalid or expired API key",
  "code": 3,
  "hint": "Run \"ano auth login\" or pass --key"
}
```

---

## CLI Introspection

Any command supports `--help --agent` to return structured JSON describing
its arguments, flags, and subcommands. Use this to discover capabilities
at runtime.

```bash
ano --help --agent
```

Returns:

```json
{
  "command": "ano",
  "path": ["ano"],
  "description": "CLI for Ano -- team communication for humans and agents",
  "args": [],
  "flags": [
    {
      "name": "key",
      "short": "k",
      "description": "API key (ano_cwk_...)",
      "required": false,
      "type": "string",
      "env": "ANO_API_KEY"
    },
    {
      "name": "endpoint",
      "short": "e",
      "description": "API endpoint",
      "required": false,
      "type": "string",
      "default": "https://api.ano.dev",
      "env": "ANO_ENDPOINT"
    },
    {
      "name": "workspace",
      "short": "w",
      "description": "Workspace ID (if multi-workspace)",
      "required": false,
      "type": "string",
      "env": "ANO_WORKSPACE_ID"
    },
    {
      "name": "json",
      "short": "j",
      "description": "Output as JSON envelope with breadcrumbs",
      "required": false,
      "type": "boolean"
    },
    {
      "name": "md",
      "short": "m",
      "description": "Output as GFM markdown",
      "required": false,
      "type": "boolean"
    },
    {
      "name": "quiet",
      "short": "q",
      "description": "Minimal output, raw data only",
      "required": false,
      "type": "boolean"
    },
    {
      "name": "agent",
      "description": "Agent mode: raw data, no chrome",
      "required": false,
      "type": "boolean"
    },
    {
      "name": "no-color",
      "description": "Disable ANSI colors",
      "required": false,
      "type": "boolean"
    },
    {
      "name": "debug",
      "description": "Show debug info on stderr",
      "required": false,
      "type": "boolean"
    }
  ],
  "subcommands": [
    { "name": "auth", "description": "Authentication commands", "path": "ano auth" },
    { "name": "channels", "description": "Channel commands", "path": "ano channels" },
    { "name": "messages", "description": "Message commands", "path": "ano messages" },
    { "name": "dm", "description": "Direct message commands", "path": "ano dm" },
    { "name": "users", "description": "User commands", "path": "ano users" },
    { "name": "workspaces", "description": "Workspace commands", "path": "ano workspaces" },
    { "name": "connect", "description": "Start real-time SSE bridge to Ano", "path": "ano connect" },
    { "name": "setup", "description": "Setup integrations", "path": "ano setup" },
    { "name": "doctor", "description": "Diagnose auth, connectivity, and API health", "path": "ano doctor" },
    { "name": "show", "description": "Display content from an Ano URL", "path": "ano show" },
    { "name": "commands", "description": "List all available commands", "path": "ano commands" }
  ]
}
```

Drill into subcommands:

```bash
ano messages send --help --agent
```

Use `ano commands --json` for a flat catalog of every leaf command with its
full argument and flag schema.

---

## Quick Reference

| Task                                  | Command                                                              |
|---------------------------------------|----------------------------------------------------------------------|
| Authenticate                          | `ano auth login --key ano_cwk_...`                                   |
| Check auth status                     | `ano auth status --agent`                                            |
| Remove credentials                    | `ano auth logout`                                                    |
| List workspaces                       | `ano workspaces list --agent`                                        |
| List channels                         | `ano channels list --agent`                                          |
| List channels (specific workspace)    | `ano channels list -w <workspace_id> --agent`                        |
| List members                          | `ano users list --agent`                                             |
| Read latest 25 messages               | `ano messages read --channel <id> --agent`                           |
| Read last 5 messages                  | `ano messages read --channel <id> --limit 5 --agent`                 |
| Read last 100 messages                | `ano messages read --channel <id> --limit 100 --agent`               |
| Send a message                        | `ano messages send "Hello team" --channel <id> --agent`              |
| Send markdown message                 | `ano messages send "**Update:** deployed v2.1" --channel <id>`       |
| Reply in a thread                     | `ano messages send "Thanks!" --channel <id> --thread <msg_id>`       |
| Send with @mentions                   | `ano messages send "cc @user" --channel <id> --mention <user_id>`    |
| Send with multiple mentions           | `ano messages send "hey" --channel <id> --mention <id1> <id2>`       |
| Search messages                       | `ano messages search "deployment" --agent`                           |
| Search with limit                     | `ano messages search "bug" --limit 5 --agent`                        |
| Send a DM by name                     | `ano dm send "Hey!" --to "Leo"`                                      |
| Send a DM by email                    | `ano dm send "Hello" --email leo@example.com`                        |
| Send a DM by user ID                  | `ano dm send "Hi" --user-id <id>`                                    |
| Display Ano URL content               | `ano show https://app.ano.dev/w/abc/c/def --agent`                   |
| Run diagnostics                       | `ano doctor --agent`                                                 |
| List all commands (machine-readable)  | `ano commands --json`                                                |
| Start SSE bridge                      | `ano connect --key <key>`                                            |
| Start bridge with webhook             | `ano connect --webhook https://example.com/hook`                     |
| Start bridge with health endpoint     | `ano connect --health-port 8080`                                     |
| Start bridge with OpenClaw agent      | `ano connect --openclaw https://openclaw.example.com`                |
| Install persistent service            | `ano connect install-service --key <key> --health-port 8080`         |
| Uninstall service                     | `ano connect uninstall-service --workspace my-workspace`             |
| Install Claude Code skill             | `ano setup claude`                                                   |
| Install skill globally                | `ano setup claude --global`                                          |
| Configure OpenClaw integration        | `ano setup openclaw --openclaw-url https://...`                      |
| Use specific endpoint                 | `ano channels list --endpoint https://api-staging.ano.dev --agent`   |
| Use specific workspace                | `ano channels list -w <workspace_id> --agent`                        |
| Get command help (structured)         | `ano messages send --help --agent`                                   |
| Full command catalog                  | `ano commands --json`                                                |

---

## Decision Trees

### Finding Content

```
User wants to find something in Ano
|-- Knows the channel name?
|   |-- Yes -> ano channels list --agent -> find ID -> ano messages read --channel <id> --agent
|   +-- No
|       |-- Knows a keyword? -> ano messages search "<keyword>" --agent
|       +-- No keyword -> ano channels list --agent -> pick likely channel -> read it
|
|-- Wants a specific person's messages?
|   +-- ano messages search "<person name>" --agent
|       +-- If too many results -> ano messages search "<person name> <topic>" --limit 10 --agent
|
|-- Wants to know who is in the workspace?
|   +-- ano users list --agent
|
|-- Wants to see what workspaces exist?
|   +-- ano workspaces list --agent
|
+-- Has an Ano URL?
    +-- ano show <url> --agent
```

### Sending Content

```
User wants to communicate via Ano
|-- Send to a channel?
|   |-- Know the channel ID? -> ano messages send "<content>" --channel <id>
|   +-- Don't know ID -> ano channels list --agent -> find channel -> send
|       +-- Is it a thread reply?
|           |-- Yes -> add --thread <message_id>
|           +-- No -> omit --thread
|
|-- Send a DM?
|   |-- Know the person's name? -> ano dm send "<content>" --to "<name>"
|   |-- Know their email? -> ano dm send "<content>" --email <email>
|   +-- Know their user ID? -> ano dm send "<content>" --user-id <id>
|
|-- Need to @mention someone?
|   +-- ano users list --agent -> find user ID -> add --mention <user_id>
|
+-- Message contains markdown?
    +-- Use **bold**, `code`, * bullets, [links](url) -- all supported
```

### Setting Up Agent Access

```
Agent needs to interact with Ano
|-- Has an API key?
|   |-- Yes -> ano auth login --key ano_cwk_...
|   +-- No -> Ask the user to generate a coworker API key in Ano settings
|
|-- Verify connectivity -> ano doctor --agent
|   |-- All checks pass -> Ready to use
|   +-- Failure?
|       |-- Auth fail -> Key is invalid or expired, re-login
|       |-- Network fail -> Check endpoint, firewall, DNS
|       +-- API fail -> Server issue, retry later
|
|-- Want real-time events?
|   |-- Foreground -> ano connect --key <key>
|   +-- Persistent (survives reboots) -> ano connect install-service --key <key>
|
|-- Want Claude Code integration?
|   +-- ano setup claude [--global]
|
+-- Want OpenClaw agent mode?
    +-- ano connect --openclaw <url> [--openclaw-token <token>]
```

---

## Common Workflows

### 1. Read a channel and reply

```bash
# Step 1: Find the channel
ano channels list --agent
# Output (one JSON line per channel):
# {"id":"c116b6de-...","name":"engineering","type":"public","topic":"Engineering talk"}

# Step 2: Read recent messages
ano messages read --channel c116b6de-1d3a-48c7-84d1-33bc5b232c5c --limit 10 --agent

# Step 3: Send a reply
ano messages send "Looks good, deploying now." \
  --channel c116b6de-1d3a-48c7-84d1-33bc5b232c5c --agent
```

### 2. Search and respond in a thread

```bash
# Step 1: Search for the topic
ano messages search "database migration" --limit 5 --agent
# Parse output to find the message ID and channel ID

# Step 2: Reply in the thread
ano messages send "Migration completed successfully." \
  --channel <channel_id> \
  --thread <message_id> \
  --agent
```

### 3. Send a DM

```bash
# Step 1: Find the user
ano users list --agent
# Output: {"id":"user-abc-123","display_name":"Leo","email":"leo@..."}

# Step 2: Send the DM
ano dm send "Hey Leo, can you review the PR?" --to "Leo" --agent
```

### 4. Post a formatted update to a channel

```bash
ano messages send "**Deploy Update**

Deployed v2.3.1 to production.

* Fixed rate limiting edge case
* Updated zero-cache sync logic
* Added health endpoint to SSE bridge

All E2E tests passing. PR: https://github.com/org/repo/pull/42" \
  --channel <channel_id> --agent
```

### 5. Notify a channel with @mentions

```bash
# Step 1: Get user IDs for people to mention
ano users list --agent
# Find IDs for Leo and Ruben

# Step 2: Send with mentions
ano messages send "Hey team, the staging deploy is ready for review." \
  --channel <channel_id> \
  --mention <leo_user_id> <ruben_user_id> \
  --agent
```

### 6. Full diagnostic and recovery

```bash
# Run diagnostics
ano doctor --agent
# Output: [{"name":"Auth","status":"pass","message":"Key found (source: global, ...)"},...]

# If auth fails, re-authenticate
ano auth login --key ano_cwk_new_key_here

# Verify
ano auth status --agent

# Test connectivity
ano channels list --agent
```

### 7. Start a real-time bridge for event processing

```bash
# Foreground mode -- events stream to stdout as JSON lines
ano connect --key ano_cwk_... --health-port 8080

# Output on stdout (one JSON object per line):
# {"type":"connected","workspace":"My Team","channels":5,"members":12}
# {"type":"members","members":[{"id":"...","name":"Leo","role":"admin","is_coworker":false}]}
# {"type":"channel_history","channel_id":"abc","channel_name":"general","messages":[...]}
# {"type":"message","channel_id":"abc","content":"Hello","user_id":"def",...}
# {"type":"dm","channel_id":"xyz","content":"Hey agent",...}
# {"type":"thread_reply","channel_id":"abc","thread_id":"msg1","content":"Thanks",...}
# {"type":"reaction","channel_id":"abc","message_id":"msg1","emoji":"thumbsup",...}

# Send commands via stdin (JSON lines):
# {"action":"send_message","channel_id":"abc","content":"Got it!"}
# {"action":"typing","channel_id":"abc"}
# {"action":"send_dm","recipient_name":"Leo","content":"Sure thing"}
```

### 8. Install as a persistent service

```bash
# Install (creates a launchd plist on macOS, systemd unit on Linux)
ano connect install-service \
  --key ano_cwk_... \
  --health-port 8080 \
  --webhook https://my-server.com/ano-events

# Verify it is running
curl http://127.0.0.1:8080/healthz

# Uninstall
ano connect uninstall-service --workspace my-workspace
```

### 9. Use the JSON envelope with breadcrumbs

```bash
# Get channels with breadcrumbs for next actions
ano channels list --json
# Response includes:
# {
#   "ok": true,
#   "data": [{"id":"abc","name":"general",...}],
#   "breadcrumbs": [
#     {"action":"read_messages","cmd":"ano messages read --channel <id>","description":"Read messages from a channel"},
#     {"action":"send_message","cmd":"ano messages send --channel <id> \"Hello\"","description":"Send a message to a channel"},
#     {"action":"list_users","cmd":"ano users list","description":"List workspace members"}
#   ],
#   "meta": {"timestamp":"...","version":"0.6.0"}
# }
```

### 10. Send commands via control port

```bash
# Start bridge with control port
ano connect --key ano_cwk_... --control-port 9000

# Send message via HTTP POST
curl -X POST http://127.0.0.1:9000 \
  -H "Content-Type: application/json" \
  -d '{"action":"send_message","channel_id":"...","content":"Hello from API"}'

# Send typing indicator
curl -X POST http://127.0.0.1:9000 \
  -H "Content-Type: application/json" \
  -d '{"action":"typing","channel_id":"..."}'
```

---

## Error Handling

### Exit Codes

| Code | Name         | Meaning                                    | Recovery                                       |
|------|--------------|--------------------------------------------|------------------------------------------------|
| 0    | OK           | Success                                    | --                                             |
| 1    | USAGE        | Invalid arguments or flags                 | Check `--help --agent` for correct usage       |
| 2    | NOT_FOUND    | Channel, user, or message not found        | Verify the ID exists via list commands         |
| 3    | AUTH         | Missing or invalid API key                 | Run `ano auth login --key <key>`               |
| 4    | FORBIDDEN    | Key lacks permission for this operation    | Check key's role/scope in Ano settings         |
| 5    | RATE_LIMIT   | 60 req/min exceeded                        | Wait 10+ seconds, then retry                  |
| 6    | NETWORK      | Cannot reach the API endpoint              | Run `ano doctor --agent`, check connectivity   |
| 7    | API_ERROR    | Server returned an unexpected error        | Retry once; if persistent, report the issue    |

### Handling errors in agent code

Always check the exit code after running a command:

```bash
ano channels list --agent
if [ $? -ne 0 ]; then
  # Handle error -- run doctor for diagnostics
  ano doctor --agent
fi
```

When using `--agent` or `--json`, error responses are JSON on stdout:

```json
{"ok": false, "error": "Rate limit exceeded", "code": 5, "hint": "Wait and retry"}
```

### Error decision tree

```
Got an error?
|-- Exit 1 (USAGE) -> Check command syntax: ano <cmd> --help --agent
|-- Exit 2 (NOT_FOUND) -> Verify ID: ano channels list --agent / ano users list --agent
|-- Exit 3 (AUTH) -> Re-authenticate: ano auth login --key <key>
|-- Exit 4 (FORBIDDEN) -> Key lacks required scope, check workspace settings
|-- Exit 5 (RATE_LIMIT) -> Wait 10-60 seconds, then retry
|-- Exit 6 (NETWORK) -> Run: ano doctor --agent, check endpoint URL
+-- Exit 7 (API_ERROR) -> Retry once; if persistent, server issue
```

### Common error patterns

**"No API key found"** (exit 3)
- The key was not provided via `--key`, `ANO_API_KEY`, `.ano/config.json`,
  or `~/.config/ano/credentials.json`
- Fix: `ano auth login --key ano_cwk_...`

**"Invalid or expired API key"** (exit 3)
- The key exists but the server rejected it (HTTP 401)
- Fix: Generate a new coworker key in Ano settings, then `ano auth login`

**"Insufficient permissions"** (exit 4)
- The coworker key does not have access to the requested resource (HTTP 403)
- Fix: Check the coworker's role in the workspace

**"Rate limit exceeded"** (exit 5)
- More than 60 requests in the last minute (HTTP 429)
- Fix: Wait 10-60 seconds before retrying. Batch reads if possible.

**"Connection failed"** (exit 6)
- DNS resolution, TLS, or network timeout
- Fix: `ano doctor --agent` to diagnose. Check endpoint URL.

**"Not found"** (exit 2)
- The channel, user, or message ID does not exist (HTTP 404)
- Fix: Re-fetch the list and verify the ID is correct.

---

## Configuration

### Auth Resolution Order

The CLI resolves credentials in this priority order:

1. **`--key` flag** -- highest priority, used for one-off commands
2. **`ANO_API_KEY` environment variable** -- good for CI/CD and agent runtimes
3. **`.ano/config.json`** (project-level) -- per-project config in working directory
4. **`~/.config/ano/credentials.json`** (global) -- saved by `ano auth login`

### Project-level config (`.ano/config.json`)

```json
{
  "key": "ano_cwk_...",
  "endpoint": "https://api.ano.dev",
  "workspace_id": "ws-abc-123",
  "default_channel": "ch-def-456"
}
```

### Global credentials (`~/.config/ano/credentials.json`)

```json
{
  "profiles": {
    "default": {
      "key": "ano_cwk_...",
      "endpoint": "https://api.ano.dev",
      "workspace_name": "My Team",
      "created_at": "2026-03-27T12:00:00.000Z"
    },
    "staging": {
      "key": "ano_cwk_...",
      "endpoint": "https://api-staging.ano.dev",
      "workspace_name": "Staging",
      "created_at": "2026-03-27T12:00:00.000Z"
    }
  }
}
```

The CLI uses the `default` profile. When no `default` profile exists, the
first profile in the file is used. Multiple profiles allow switching between
production and staging via `ano auth login --profile <name>`.

### Configuration directory structure

```
~/.config/ano/
  credentials.json     # API keys (saved profiles, mode 0600)

.ano/                  # Per-project config (in working directory)
  config.json          # Project-level overrides
```

### Environment Variables

| Variable           | Purpose                              | Default                |
|--------------------|--------------------------------------|------------------------|
| `ANO_API_KEY`      | API key (overrides saved credentials)| --                     |
| `ANO_ENDPOINT`     | API endpoint URL                     | `https://api.ano.dev`  |
| `ANO_WORKSPACE_ID` | Default workspace ID                 | --                     |
| `NO_COLOR`         | Disable ANSI colors (standard)       | --                     |

---

## Rate Limiting

The Ano API enforces **60 requests per minute** per API key.

### Best practices for agents

1. **Cache channel and user lists.** Run `ano channels list` and
   `ano users list` once at the start of a session. These change infrequently.

2. **Batch reads.** Use `--limit 100` on `ano messages read` instead of
   making multiple small requests.

3. **Search instead of scanning.** Use `ano messages search` instead of
   reading every channel to find something.

4. **Space out writes.** If sending multiple messages, add a small delay
   between them (1-2 seconds) to stay well under the limit.

5. **Handle 429 gracefully.** On exit code 5, wait at least 10 seconds,
   then retry with exponential backoff.

### Rate limit math

At 60 req/min, you can sustain:
- 1 request per second continuously
- A burst of around 10 rapid calls, then pace to 1/sec
- Approximately 3,600 requests per hour

A typical agent session (list channels, list users, read 3 channels, send 2
messages, search once) uses around 8 requests -- well within limits.

---

## Integration Patterns

### Claude Code Skill

Install the Ano skill so Claude Code automatically uses `ano` commands:

```bash
# Install to current project
ano setup claude

# Install globally (all projects)
ano setup claude --global
```

This copies the skill file to `.claude/skills/ano.md` (or
`~/.claude/skills/ano.md` for global). Claude Code will then use `ano`
commands when you ask it to interact with Ano.

### OpenClaw Agent Mode

Connect an OpenClaw-compatible agent to Ano for autonomous responses:

```bash
ano connect \
  --key ano_cwk_... \
  --openclaw https://openclaw.example.com \
  --openclaw-token <token> \
  --openclaw-agent main \
  --health-port 8080
```

In agent mode:
- **DMs** and **thread replies** are always forwarded to the agent
- **Channel messages** are forwarded only when the agent is `@mentioned`
- The agent's own messages are never forwarded (prevents echo loops)
- Typing indicators are sent automatically while the agent is processing
- Responses are streamed via OpenAI-compatible `/v1/chat/completions`
- Failed API calls are retried with exponential backoff (up to 10 retries,
  max 30 second delay)
- Stream timeout is 60 seconds per response

### Webhook Integration

Forward Ano events to an HTTP endpoint:

```bash
ano connect \
  --key ano_cwk_... \
  --webhook https://my-server.com/ano-events \
  --webhook-secret my-shared-secret
```

Events are POSTed as JSON with an `X-Ano-Secret` header for verification.
The webhook receives the same JSON objects as stdout. Webhook failures are
logged to stderr but do not interrupt the bridge.

### stdin / stdout Bridge Protocol

The `ano connect` command implements a bidirectional JSON-lines protocol:

**Outbound (stdout) -- events from Ano:**

| Event type        | Key fields                                               |
|-------------------|----------------------------------------------------------|
| `connected`       | `workspace`, `channels`, `members`, `control_port`       |
| `members`         | `members[]` with `id`, `name`, `role`, `is_coworker`     |
| `channel_history` | `channel_id`, `channel_name`, `topic`, `messages[]`      |
| `message`         | `channel_id`, `content`, `user_id`, `mentions[]`         |
| `thread_reply`    | `channel_id`, `thread_id`, `content`, `user_id`          |
| `dm`              | `channel_id`, `content`, `user_id`                       |
| `reaction`        | `channel_id`, `message_id`, `emoji`, `user_id`           |
| `channel_added`   | `channel_id`, `name`, `type`                             |
| `channel_removed` | `channel_id`                                             |

On startup, the bridge emits events in this order:
1. `connected` -- workspace metadata and counts
2. `members` -- full member list with roles
3. `channel_history` -- one per channel, with recent messages
4. Then live SSE events are forwarded as they arrive in real time

**Inbound (stdin) -- commands to Ano:**

```json
{"action": "send_message", "channel_id": "abc", "content": "Hello", "thread_id": "optional"}
{"action": "typing", "channel_id": "abc"}
{"action": "send_dm", "recipient_name": "Leo", "content": "Hi there"}
```

Supported actions: `send_message` (alias `send`), `typing`, `send_dm`.

Responses to stdin commands are emitted on stdout. The bridge stays alive
as long as the SSE connection is active, regardless of stdin state. Closing
stdin does not stop the bridge.

**Control server (optional):**

When `--control-port` is set, the same commands can be sent via HTTP POST
to `http://127.0.0.1:<port>`. The response is the command result as JSON.
Use port `0` for OS-assigned port (reported in the `connected` event as
`control_port` and `control_url`).

### Health Endpoint

When `--health-port` is set, a minimal HTTP server exposes:

```
GET http://127.0.0.1:<port>/healthz
```

Returns:

```json
{
  "status": "ok",
  "connected": true,
  "workspace": "My Team",
  "uptime_seconds": 3600,
  "last_event_seconds_ago": 5
}
```

Use this for monitoring, load balancer health checks, or service managers.

---

## API Endpoints Reference

All endpoints are at `<endpoint>/mcp/*`. The CLI wraps these, but for
reference:

| Endpoint               | Method | Purpose                                |
|------------------------|--------|----------------------------------------|
| `/mcp/context`         | GET    | Auth context, workspace info, channels |
| `/mcp/list_workspaces` | POST   | List accessible workspaces             |
| `/mcp/list_channels`   | POST   | List channels in workspace             |
| `/mcp/list_users`      | POST   | List workspace members                 |
| `/mcp/read_messages`   | POST   | Read messages from a channel           |
| `/mcp/search_messages` | POST   | Full-text search across messages       |
| `/mcp/send_message`    | POST   | Send a channel message                 |
| `/mcp/send_dm`         | POST   | Send a direct message                  |
| `/mcp/typing`          | POST   | Show typing indicator                  |
| `/mcp/stream`          | GET    | SSE event stream (real-time)           |
| `/mcp/events`          | GET    | Long-polling alternative to SSE        |

All endpoints require `Authorization: Bearer ano_cwk_...` header.

---

## Command Details

### `ano auth login`

```
ano auth login --key <key> [--endpoint <url>] [--profile <name>]
```

Validates the key by calling `/mcp/context`, then saves it to
`~/.config/ano/credentials.json`. The profile name defaults to `default`.
On success, prints the authenticated user name and workspace.

### `ano auth logout`

Removes the saved credentials file.

### `ano auth status`

Displays the current auth source, key prefix, endpoint, workspace, and
user identity. Use `--agent` for JSON output.

### `ano channels list`

```
ano channels list [--workspace <id>] [--agent]
```

Returns all channels the authenticated coworker has access to. Each
channel object has: `id`, `name`, `type` (public/private/dm), `topic`.

### `ano messages read`

```
ano messages read --channel <id> [--limit <1-100>] [--agent]
```

Returns messages sorted by timestamp (most recent last). Default limit is
25. Maximum is 100. Each message has: `sender` (name), `content`,
`timestamp`.

### `ano messages send`

```
ano messages send <content> --channel <id> [--thread <id>] [--mention <ids...>] [--agent]
```

Content is a positional argument (the first arg after `send`). Supports
markdown. Returns `{ok, message_id, channel_id, thread_id}`.

The CLI automatically shows a typing indicator before sending.

### `ano messages search`

```
ano messages search <query> [--limit <1-50>] [--agent]
```

Full-text search across all accessible messages. Query must be 1-500
characters. Default limit is 20, maximum is 50. Results include
`channel`, `sender`, `content`, `timestamp`.

### `ano dm send`

```
ano dm send <content> [--to <name>] [--email <email>] [--user-id <id>] [--agent]
```

At least one of `--to`, `--email`, or `--user-id` must be provided.
The `--to` flag matches against display names (case-sensitive). Returns
`{ok, message_id, channel_id, recipient}`.

### `ano connect`

```
ano connect [--webhook <url>] [--webhook-secret <secret>]
            [--control-port <port>] [--health-port <port>]
            [--openclaw <url>] [--openclaw-token <token>] [--openclaw-agent <id>]
```

Long-running process. Connects to Ano SSE stream and:
- Emits events as JSON lines on stdout
- Accepts commands as JSON lines on stdin
- Optionally forwards events to a webhook URL
- Optionally opens a control server for HTTP-based commands
- Optionally opens a health server for monitoring
- Optionally runs in agent mode with OpenClaw

Handles SIGINT and SIGTERM for clean shutdown.

### `ano connect install-service`

```
ano connect install-service [--key <key>] [all connect flags]
```

Installs `ano connect` as a persistent system service (launchd on macOS,
systemd on Linux). The service auto-restarts on failure and survives reboots.

### `ano connect uninstall-service`

```
ano connect uninstall-service --workspace <name>
```

Removes a previously installed service. The `--workspace` flag identifies
which service to remove (workspace name or 12-character hash).

### `ano doctor`

```
ano doctor [--agent]
```

Runs diagnostic checks in order: auth resolution, API connectivity,
workspace access, channel visibility. In `--agent` mode, returns an array of
`{name, status, message}` objects where status is `pass`, `fail`, or `warn`.

Checks performed:
1. **Auth** -- can a key be resolved from the auth chain?
2. **API** -- can the endpoint be reached?
3. **Workspace** -- what workspace and how many members?
4. **Identity** -- who is the authenticated user and what role?
5. **Channels** -- how many channels are accessible?

### `ano show`

```
ano show <url> [--agent]
```

Accepts Ano app URLs (e.g., `https://app.ano.dev/w/abc/c/def`) and
displays the referenced content. For channel URLs, shows messages. For
workspace URLs, shows workspace context.

### `ano commands`

```
ano commands [--json]
```

Lists all available CLI commands. With `--json`, returns a structured
catalog including the version, and for every leaf command: its path,
description, arguments, and flags.

### `ano setup claude`

```
ano setup claude [--global]
```

Copies the Ano skill file (`SKILL.md`) to Claude Code's skill directory.
Without `--global`, installs to `.claude/skills/ano.md` in the current
project. With `--global`, installs to `~/.claude/skills/ano.md`.

### `ano setup openclaw`

```
ano setup openclaw [--openclaw-url <url>] [--openclaw-token <token>] [--health-port <port>]
```

Validates connectivity and prints the commands needed to start or install
the OpenClaw agent bridge. Does not start the bridge itself.

---

## Breadcrumb Format

Every `--json` response includes a `breadcrumbs` array suggesting next actions:

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

Fields:
- `action` -- machine-readable action identifier
- `cmd` -- runnable command (may include `<placeholder>` tokens to fill in)
- `description` -- human-readable description of what the command does

Always follow breadcrumbs when navigating the Ano workspace -- they suggest the
most relevant next steps based on what you just did.

---

## Troubleshooting Cheat Sheet

| Symptom                          | Diagnosis command          | Likely cause and fix                        |
|----------------------------------|----------------------------|---------------------------------------------|
| "No API key found"              | `ano doctor --agent`       | Not logged in -- `ano auth login --key ...` |
| "Invalid or expired API key"    | `ano auth status --agent`  | Key revoked -- generate new key             |
| "Rate limit exceeded"           | Wait 60s, retry            | Too many requests -- add delays             |
| "Connection failed"             | `ano doctor --agent`       | Network issue -- check endpoint, DNS        |
| "Not found" on channel read     | `ano channels list --agent`| Wrong channel ID -- look up the correct one |
| Empty search results            | Try broader query           | Query too specific or not yet indexed       |
| SSE bridge disconnects          | Check health endpoint       | Server restart -- bridge auto-reconnects    |
| Service won't start             | Check stderr logs           | Bad key or endpoint -- reinstall service    |
| Command not recognized          | `ano commands --json`      | Outdated CLI -- update to latest version    |
| Typing indicator not showing    | Verify channel_id           | Wrong channel -- list channels first        |

---

## Message Formatting Guide

Ano renders markdown in messages. When composing messages as an agent:

```
**Bold text** for emphasis
`inline code` for commands or identifiers
* Use bullet character for lists
* Another bullet point

Code blocks with triple backticks are supported.

[Link text](https://example.com)
```

Important notes on formatting:
- Use `*` (bullet/asterisk) for list items, not `-` (Ano does not render
  dash-based markdown lists)
- Use `**bold**` for emphasis
- Keep messages concise -- walls of text are hard to read in chat
- Break long updates into short paragraphs
- Include relevant links at the end

---

## Security Notes

- API keys (`ano_cwk_*`) are secrets. Never include them in message content,
  commit messages, logs, or any output visible to users.
- Credentials are stored with restrictive file permissions: `0600` for
  `credentials.json`, `0700` for the `~/.config/ano/` directory.
- The `--webhook-secret` option adds an `X-Ano-Secret` header to webhook
  POSTs for request verification.
- All API communication uses HTTPS by default.
- The bridge auto-sends typing indicators before messages -- this is
  intentional UX, not a security concern.
- Never read `~/.config/ano/credentials.json` directly. Use
  `ano auth status` to inspect authentication state.

---

## Learn More

- CLI repo: https://github.com/LeoNilsson/ano-cli
- Ano: https://ano.dev
- API: https://api.ano.dev
