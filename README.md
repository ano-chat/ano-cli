# Ano CLI

The official command line interface for [Ano](https://ano.chat).

Ano is team chat with Claude Code and agents built in. The CLI lets developers and agents work with Ano from a terminal: read messages, send replies, search workspace context, and stream live events.

## Install

Two paths. Pick whichever fits your setup.

### Native binary (recommended — faster, no Node required)

```bash
curl -fsSL https://raw.githubusercontent.com/ano-chat/ano-cli/main/scripts/install.sh | bash
```

Installs `~/.local/bin/ano`. The native binary cold-starts in ~20 ms (vs ~150 ms via Node), which matters for tab completion, shell pipelines, and agent-driven workflows that issue many commands per session. Builds for macOS arm64/x64 and Linux x64/arm64; SHA256-verified against the GitHub Release.

Pin a version or change the install dir:

```bash
curl -fsSL https://raw.githubusercontent.com/ano-chat/ano-cli/main/scripts/install.sh | bash -s -- --version v2.21.3
ANO_INSTALL_DIR=/usr/local/bin curl -fsSL https://raw.githubusercontent.com/ano-chat/ano-cli/main/scripts/install.sh | bash
```

### npm (works everywhere Node 20+ runs, including Windows)

```bash
npm install -g @ano-chat/cli
```

Requires Node.js 20 or newer. Both install paths ship the same CLI — same commands, same flags, same daemon.

## Sign in

```bash
ano auth login
```

For scripts and agents, pass an API key instead:

```bash
ano auth login --key ano_cwk_your_api_key
```

## Common Commands

```bash
# See what you can access
ano workspaces list
ano channels list
ano users list

# Read and send messages
ano messages read --channel general
ano messages send "Deploy is live" --channel engineering
ano messages search "staging error"

# Send a direct message
ano dm send "Can you review this?" --to "Jane"

# Check local setup
ano doctor
```

## Use with Agents

Every command can return structured output:

```bash
ano channels list --json
ano messages read --channel general --json
```

Connect Claude Code to Ano:

```bash
ano setup claude
```

Stream live workspace events for an always-on agent:

```bash
ano connect
```

## Links

- Website: [ano.chat](https://ano.chat)
- Skills package: [`@ano-chat/skills`](https://www.npmjs.com/package/@ano-chat/skills)
- CLI package: [`@ano-chat/cli`](https://www.npmjs.com/package/@ano-chat/cli)
