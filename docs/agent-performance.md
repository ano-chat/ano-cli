# Agent Performance

Ano is designed for terminal-driven work. Agents often issue many CLI commands
in one session, so small per-call costs add up quickly.

## Fast Path

Use this order:

1. Spawn `ano agent stdio` once per agent task/session.
2. First exec: `agent context -w <workspace-id> --json`.
3. Reuse IDs from that response instead of listing channels and users again.
4. Send every later command through the same stdio process with `--agent`,
   `--json`, or `--quiet`.
5. Fall back to one-shot `ano ... --agent` only if the host cannot keep a child
   process alive.
6. Use `ano daemon status --json` only when debugging one-shot CLI latency or
   replica state.

Transport priority:

| Priority | Transport             | Use when                                  |
| -------- | --------------------- | ----------------------------------------- |
| 1        | `ano agent stdio`     | Agent host can keep a child process alive |
| 2        | one-shot native `ano` | Stdio is unavailable                      |
| 3        | daemon-backed CLI     | Human/shell/fallback one-shot commands    |
| 4        | MCP                   | Host requires MCP; not inherently faster  |

The daemon is a backup for one-shot invocations. It is not required for the
preferred stdio path.

## Roundtrip Budgets

Count one stdio `exec` frame, or one one-shot CLI process, as one agent
roundtrip.

| Workflow                            | Target |
| ----------------------------------- | ------ |
| Startup context                     | 1      |
| Send to named channel               | 1      |
| Send DM by name                     | 1      |
| Read known channel                  | 1      |
| Read known channel, then reply      | 2      |
| Search, inspect channel, then reply | 3      |
| Create/update table item            | 2      |

Do not spend discovery roundtrips when a command can resolve the name
server-side. Use `messages send --channel-name ... -w <workspace-id>` for named
channels and `dm send --to "Name"` for DMs.

## Startup Context

In one-shot fallback mode:

```bash
ano agent context -w <workspace-id> --json
```

In stdio mode, send it as the first exec frame:

```json
{
  "id": 1,
  "v": 1,
  "method": "exec",
  "argv": ["agent", "context", "-w", "<workspace-id>", "--json"]
}
```

The response includes:

- `context`: current user and workspace metadata.
- `channels`: channel rows, served from Zero when available.
- `users`: workspace members, served from Zero when available.
- `tables`: table summaries.
- `sources`: where each section came from.
- `fast_path`: whether the local Zero fast path was available.

This replaces the common startup sequence:

```bash
ano channels list --json -w <workspace-id>
ano users list --json -w <workspace-id>
ano tables list --json -w <workspace-id>
ano daemon status --json
```

## Persistent Stdio Mode

```bash
ano agent stdio
```

The process reads one JSON request per line from stdin and writes one JSON
response per line to stdout.

Every exec request must ask for machine-readable output with `--agent`,
`--json`, or `--quiet`. Requests without one of those flags are rejected before
dispatch.

Ping:

```json
{ "id": 1, "v": 1, "method": "ping" }
```

Exec:

```json
{
  "id": 2,
  "v": 1,
  "method": "exec",
  "argv": ["channels", "list", "--agent", "-w", "<workspace-id>"],
  "cwd": "/path/to/project",
  "env": {
    "ANO_PROFILE": "default"
  }
}
```

Response:

```json
{
  "id": 2,
  "ok": true,
  "stdout": "{\"id\":\"...\",\"name\":\"general\"}\n",
  "stderr": "",
  "exitCode": 0,
  "dispatchMs": 4
}
```

The protocol is explicit, but it does not require end-user interaction. Codex,
Claude, or another integration can start the process after normal CLI auth and
keep it alive for the session.

Commands that need stdin, such as `--file -`, are rejected in stdio mode because
stdin belongs to the protocol stream. Long-running servers such as `ano connect`
and `ano daemon serve` are also rejected.

## Daemon Interaction

`ano agent stdio` is not run inside the shared daemon. It is its own persistent
process owned by the agent integration. On startup it warms the same HTTP and
Zero runtime state as the daemon. Commands executed through stdio still use the
normal command implementation, auth resolution, output modes, and Zero/REST
fallback behavior.

The shared daemon remains useful for normal one-shot shell calls:

```bash
ano daemon status --json
```

If latency is unexpectedly high, check:

- Daemon running state and version.
- Zero connection status.
- Replica size and drift warnings.
- Circuit-breaker state.
