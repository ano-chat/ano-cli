---
name: ano-payloads
description: "INVOKE THIS SKILL when you see <ano_payload> XML blocks in your input. These are structured messages sent from the Ano desktop app via the 'Send to Shell' gesture. This skill teaches you how to parse, understand, and respond to Ano payloads containing chat messages, threads, files, and channels."
version: 1.0.0
---

# Ano Payload Skill

When a user highlights text in the Ano desktop app and clicks "Send to Shell", a structured XML payload is injected into your terminal input. This skill teaches you how to handle these payloads.

## Payload Format

Payloads arrive as `<ano_payload>` XML blocks with this structure:

```xml
<ano_payload version="1" id="pld_abc123">
  <source>
    <app>ano</app>
    <runtime>electron</runtime>
    <user id="usr_123" handle="ruben" />
    <workspace id="ws_456" />
    <sent_at>2026-04-14T12:00:00.000Z</sent_at>
  </source>
  <items>
    <message id="msg_789" url="ano://message/msg_789"
      channel_id="ch_abc" channel_name="engineering"
      author_id="usr_321" author_handle="leo"
      author_name="Leo Nilsson" timestamp="2026-04-14T11:55:00.000Z">
      <full>The full message text goes here</full>
      <selection>Optional: only the highlighted portion</selection>
    </message>
  </items>
</ano_payload>
```

## Item Types

### message

A chat message from a channel or DM.

- `full` — the complete message text
- `selection` (optional) — only the part the user highlighted
- If `selection` is present, focus on that text but use `full` for context
- `thread_id` (optional) — present if the message is part of a thread

### thread

A reference to an entire thread.

- `root_message_id` — the thread's root message
- `message_count` — how many messages are in the thread

### file

An attached file.

- `filename`, `file_type`, `file_size` — file metadata

### channel

A reference to a channel.

- `name` — the channel name

## How to Respond

1. **Acknowledge the context** — mention what was sent (e.g., "I see a message from Leo in #engineering")
2. **Focus on the selection** if present, using the full message as context
3. **Be helpful** — the user sent this to you for a reason. Common intents:
   - Ask you to explain, summarize, or analyze the message
   - Ask you to draft a reply
   - Ask you to act on the content (create a ticket, write code, etc.)
   - Provide context for a question they're about to ask
4. **Don't repeat the XML** — parse it and respond naturally
5. **Reference the source** — if relevant, mention the channel name, author, or timestamp

## Responding Back to Ano

After processing a payload, the user may click "Reply to Thread" or "Send to Chat" in the terminal UI. These buttons send your terminal output back to the Ano chat. Write your responses with this in mind — keep them concise and well-formatted.

## Example Interaction

User sends a payload with a message from #engineering saying "Can someone review PR #847? It adds liquid glass support."

Good response:

> Leo posted in #engineering asking for a review of PR #847 (liquid glass support). Want me to review the PR, summarize the changes, or draft a response?

Bad response:

> I received an ano_payload XML block containing a message element with id msg_789...
