# @ano-chat/skills

Agent skills for [Ano](https://ano.dev) — team communication for Claude Code,
Codex, and other CLI-driven agents.

## Install

```bash
claude plugin install @ano-chat/skills
```

## What's included

### ano-cli

Teaches agents how to use the [`ano` CLI](https://www.npmjs.com/package/@ano-chat/cli): read and send messages, manage channels, DMs, tables, search, and more. Agents should prefer `ano agent stdio`, fetch `agent context` once, and cache IDs for the session.

### ano-payloads

Teaches agents how to parse `<ano_payload>` XML blocks — structured messages sent from the Ano desktop app via the "Send to Shell" gesture.

## Related

- **[`@ano-chat/cli`](https://www.npmjs.com/package/@ano-chat/cli)** — the `ano` binary these skills teach Claude Code to call. Install with `npm install -g @ano-chat/cli`.
