/**
 * Bridge: SSE events → stdout (JSON lines), stdin (JSON lines) → REST API.
 *
 * Process lifecycle is controlled by SSE, not stdin.
 * Stdin is optional — the bridge stays alive as long as SSE is connected.
 *
 * Optional webhook mode: events are also POSTed to a webhook URL.
 * Optional control port: HTTP server accepts commands (same format as stdin).
 * Optional agent mode: --openclaw connects to an OpenAI-compatible endpoint
 *   and runs a full agent loop (SSE → typing → chat/completions → send_message).
 * Optional health port: minimal HTTP server reporting SSE connection status.
 */
import { createInterface } from "node:readline";
import { createServer, type Server } from "node:http";
import { createSSEClient } from "./sse.js";
import { retryFetch, PermanentError } from "./retry.js";
import { startHealthServer } from "./health.js";

export type BridgeOptions = {
  apiKey: string;
  endpoint: string;
  webhookUrl?: string;
  webhookSecret?: string;
  /** Port for the HTTP control server. 0 = OS-assigned. undefined = no server. */
  controlPort?: number;
  /** OpenClaw / OpenAI-compatible base URL. Enables agent mode. */
  openclawUrl?: string;
  /** Bearer token for OpenClaw auth. */
  openclawToken?: string;
  /** Agent ID — sent as x-openclaw-agent-id header and model name. */
  openclawAgent?: string;
  /** Port for the health server. undefined = no health server. */
  healthPort?: number;
};

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function log(msg: string) {
  process.stderr.write(`[ano-connect] ${msg}\n`);
}

async function apiPost(
  endpoint: string,
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${endpoint}/mcp${path}`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

export async function startBridge(options: BridgeOptions) {
  const { apiKey, endpoint, webhookUrl, webhookSecret } = options;

  // ── emit: stdout + optional webhook ───────────────────────────────
  function emit(data: Record<string, unknown>) {
    process.stdout.write(JSON.stringify(data) + "\n");

    if (webhookUrl) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (webhookSecret) {
        headers["X-Ano-Secret"] = webhookSecret;
      }
      fetch(webhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      }).catch((err) => {
        log(
          `Webhook POST failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  // ── handleCommand: shared by stdin and control server ─────────────
  async function handleCommand(
    cmd: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const action = cmd.action as string | undefined;
    if (!action) {
      return { type: "error", error: 'Missing "action" field' };
    }

    switch (action) {
      case "send":
      case "send_message": {
        if (!cmd.channel_id || !cmd.content) {
          return {
            type: "error",
            error: "send_message requires channel_id and content",
          };
        }
        const channelId = cmd.channel_id as string;
        // Auto-typing before send
        apiPost(endpoint, apiKey, "/typing", {
          channel_id: channelId,
        }).catch(() => {});

        const result = await apiPost(endpoint, apiKey, "/send_message", {
          channel_id: channelId,
          content: cmd.content as string,
          ...(cmd.thread_id ? { thread_id: cmd.thread_id } : {}),
          ...(cmd.mentions ? { mentions: cmd.mentions } : {}),
        });
        return { type: "sent", ...result };
      }

      case "typing": {
        if (!cmd.channel_id) {
          return { type: "error", error: "typing requires channel_id" };
        }
        await apiPost(endpoint, apiKey, "/typing", {
          channel_id: cmd.channel_id as string,
        });
        return { type: "ok", action: "typing" };
      }

      case "send_dm": {
        const result = await apiPost(endpoint, apiKey, "/send_dm", {
          ...(cmd.recipient_name ? { recipient_name: cmd.recipient_name } : {}),
          ...(cmd.recipient_email
            ? { recipient_email: cmd.recipient_email }
            : {}),
          ...(cmd.user_id ? { recipient_name: cmd.user_id } : {}),
          content: cmd.content as string,
          ...(cmd.workspace_id ? { workspace_id: cmd.workspace_id } : {}),
        });
        return { type: "sent", ...result };
      }

      default:
        return { type: "error", error: `Unknown action: ${action}` };
    }
  }

  // Keep process alive regardless of stdin/stdout state.
  // SSE controls the lifecycle, not stdin.
  const keepalive = setInterval(() => {}, 60_000);

  // 1. Get context on startup — retry on 502/503 (server restarting)
  log("Connecting...");
  let context: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const contextRes = await fetch(`${endpoint}/mcp/context`, {
        headers: authHeaders(apiKey),
      });
      if (contextRes.ok) {
        context = (await contextRes.json()) as Record<string, unknown>;
        break;
      }
      if (contextRes.status >= 500) {
        log(
          `Context returned ${contextRes.status}, retrying in ${(attempt + 1) * 2}s...`,
        );
        await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
        continue;
      }
      log(`Failed to get context: ${contextRes.status}`);
      process.exit(1);
    } catch (err) {
      log(
        `Connection error: ${err instanceof Error ? err.message : String(err)}, retrying...`,
      );
      await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
    }
  }
  if (!context) {
    log("Failed to connect after 5 attempts");
    process.exit(1);
  }

  const user = context.user as { id: string; name: string } | undefined;
  const selfUserId = user?.id;
  if (options.openclawUrl && !selfUserId) {
    log("Agent mode requires user.id from /mcp/context — got none, exiting");
    process.exit(1);
  }
  const workspace = context.workspace as
    | { id: string; name: string }
    | undefined;
  const channels = context.channels as
    | Array<{
        id: string;
        name: string;
        type: string;
        topic: string | null;
        recent_messages: Array<{
          id: string;
          content: string;
          sender: { name: string };
          created_at: number;
        }>;
      }>
    | undefined;
  const members = context.members as
    | Array<{
        id: string;
        name: string;
        role: string;
        is_coworker: boolean;
      }>
    | undefined;

  // ── Agent mode (OpenClaw) ─────────────────────────────────────────
  type AgentTask = { event: Record<string, unknown> };
  const agentQueue: AgentTask[] = [];
  let agentBusy = false;

  async function processAgentQueue() {
    if (agentBusy) return;
    const task = agentQueue.shift();
    if (!task) return;

    agentBusy = true;
    try {
      await handleAgentEvent(task.event);
    } catch (err) {
      log(`Agent error: ${err instanceof Error ? err.message : String(err)}`);
    }
    agentBusy = false;
    // Process next in queue (fire-and-forget with catch to avoid unhandled rejection)
    processAgentQueue().catch(() => {});
  }

  function enqueueAgentEvent(event: Record<string, unknown>) {
    agentQueue.push({ event });
    processAgentQueue();
  }

  async function handleAgentEvent(event: Record<string, unknown>) {
    const openclawUrl = options.openclawUrl!;
    const openclawToken = options.openclawToken;
    const openclawAgent = options.openclawAgent ?? "main";

    const channelId = event.channel_id as string | undefined;
    const content = event.content as string | undefined;
    const senderId = event.user_id as string | undefined;
    // thread_id from the event payload — present on thread_reply events
    const threadId = event.thread_id as string | undefined;

    if (!channelId || !content) return;

    // Step 2: Typing indicator
    apiPost(endpoint, apiKey, "/typing", {
      channel_id: channelId,
    }).catch(() => {});

    // Step 3: Call OpenClaw (streaming) with retry
    const reqHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "x-openclaw-agent-id": openclawAgent,
    };
    if (openclawToken) {
      reqHeaders["Authorization"] = `Bearer ${openclawToken}`;
    }

    const chatBody = {
      model: `openclaw:${openclawAgent}`,
      stream: true,
      messages: [{ role: "user", content }],
      user: `ano:${senderId ?? "unknown"}`,
    };

    let res: Response;
    try {
      res = await retryFetch(
        `${openclawUrl}/v1/chat/completions`,
        {
          method: "POST",
          headers: reqHeaders,
          body: JSON.stringify(chatBody),
        },
        { maxRetries: 10, baseDelayMs: 1000, maxDelayMs: 30_000 },
      );
    } catch (err) {
      if (err instanceof PermanentError) {
        log(`OpenClaw permanent error (${err.status}): ${err.message}`);
      } else {
        log(
          `OpenClaw retries exhausted: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }

    // Step 4: Read streaming response
    const body = res.body;
    if (!body) {
      log("OpenClaw returned empty body");
      return;
    }

    let accumulated = "";
    let lastTypingAt = Date.now();
    const TYPING_INTERVAL = 3000;
    const TIMEOUT = 60_000;

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const { done, value } = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error("OpenClaw stream timeout (60s)"));
            }, TIMEOUT);
          }),
        ]);
        clearTimeout(timer);

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data: ")) continue;

          try {
            const chunk = JSON.parse(trimmed.slice(6)) as {
              choices?: Array<{
                delta?: { content?: string };
              }>;
            };
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              accumulated += delta;
            }
          } catch {
            // Skip unparseable chunks
          }
        }

        // Re-send typing every ~3s
        if (Date.now() - lastTypingAt >= TYPING_INTERVAL) {
          lastTypingAt = Date.now();
          apiPost(endpoint, apiKey, "/typing", {
            channel_id: channelId,
          }).catch(() => {});
        }
      }
    } catch (err) {
      log(
        `OpenClaw stream error: ${err instanceof Error ? err.message : String(err)}`,
      );
      reader.cancel().catch(() => {});
      if (!accumulated.trim()) return;
      // If we have partial content, still try to send it
    }

    // Step 5: Send response to Ano
    if (!accumulated.trim()) {
      log("OpenClaw returned empty response");
      return;
    }

    try {
      const sendResult = await apiPost(endpoint, apiKey, "/send_message", {
        channel_id: channelId,
        content: accumulated,
        ...(threadId ? { thread_id: threadId } : {}),
      });
      emit({ type: "agent_sent", ...sendResult });
    } catch (err) {
      log(
        `Failed to send agent response: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Control server (optional) ─────────────────────────────────────
  let controlServer: Server | undefined;
  let controlPort: number | undefined;
  let controlUrl: string | undefined;

  if (options.controlPort !== undefined) {
    controlServer = createServer(async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const reqBody = Buffer.concat(chunks).toString();

      let cmd: Record<string, unknown>;
      try {
        cmd = JSON.parse(reqBody) as Record<string, unknown>;
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

      try {
        const result = await handleCommand(cmd);
        const isError = result.type === "error";
        res.writeHead(isError ? 400 : 200, {
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify(result));
        if (!isError) emit(result);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    });

    await new Promise<void>((resolve) => {
      controlServer!.listen(options.controlPort, "127.0.0.1", () => {
        const addr = controlServer!.address();
        if (addr && typeof addr === "object") {
          controlPort = addr.port;
          controlUrl = `http://127.0.0.1:${controlPort}`;
          log(`Control server listening on ${controlUrl}`);
        }
        resolve();
      });
    });
  }

  const agentMode = !!options.openclawUrl;
  if (agentMode) {
    log(
      `Agent mode: ${options.openclawUrl} (agent: ${options.openclawAgent ?? "main"})`,
    );
  }

  emit({
    type: "connected",
    workspace: workspace?.name ?? "unknown",
    channels: channels?.length ?? 0,
    members: members?.length ?? 0,
    ...(controlPort !== undefined ? { control_port: controlPort } : {}),
    ...(controlUrl ? { control_url: controlUrl } : {}),
    ...(agentMode ? { agent_mode: true } : {}),
  });

  if (members && members.length > 0) {
    emit({
      type: "members",
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        is_coworker: m.is_coworker,
      })),
    });
  }

  if (channels) {
    for (const ch of channels) {
      if (ch.recent_messages && ch.recent_messages.length > 0) {
        emit({
          type: "channel_history",
          channel_id: ch.id,
          channel_name: ch.name,
          channel_type: ch.type,
          topic: ch.topic,
          messages: ch.recent_messages,
        });
      }
    }
  }

  // 2. Start SSE listener → stdout (+ agent mode if enabled)
  // cleanup is a late-bound reference — assigned after all servers are created
  let cleanup = () => {
    clearInterval(keepalive);
  };

  const startedAt = Date.now();
  const sse = createSSEClient({
    url: `${endpoint}/mcp/stream`,
    headers: { Authorization: `Bearer ${apiKey}` },
    onConnect: () => log("SSE connected"),
    onError: (err) => log(`SSE error: ${err.message}, reconnecting...`),
    onUnrecoverable: (status) => {
      log(`Unrecoverable SSE error (${status}), exiting`);
      cleanup();
      process.exit(1);
    },
    onEvent: (event) => {
      try {
        const payload = JSON.parse(event.data) as Record<string, unknown>;
        const emitted = {
          ...payload,
          type: event.type,
          _event_id: event.id,
        };
        emit(emitted);

        // Agent mode: enqueue relevant events
        if (agentMode) {
          const t = event.type;
          const userId = payload.user_id as string | undefined;
          if (userId === selfUserId) {
            // Skip own messages
          } else if (t === "dm" || t === "thread_reply") {
            // Always respond to DMs and thread replies
            enqueueAgentEvent(emitted);
          } else if (t === "message") {
            // In channels, only respond when @mentioned
            const mentions = payload.mentions as string[] | undefined;
            if (selfUserId && mentions?.includes(selfUserId)) {
              enqueueAgentEvent(emitted);
            }
          }
        }
      } catch {
        // Non-JSON event, emit raw
        emit({ type: event.type, raw: event.data });
      }
    },
  });

  // 3. Health server (optional — started after SSE so we can read its state)
  let healthServer: Server | undefined;
  if (options.healthPort !== undefined) {
    healthServer = await startHealthServer(options.healthPort, {
      connected: sse.connected,
      lastEventTime: sse.lastEventTime,
      workspace: workspace?.name ?? "unknown",
      startedAt,
    });
    const addr = healthServer.address();
    if (addr && typeof addr === "object") {
      log(`Health server listening on http://127.0.0.1:${addr.port}/healthz`);
    }
  }

  // 4. Start stdin reader → REST API (optional — process stays alive without it)
  if (process.stdin.readable) {
    const rl = createInterface({ input: process.stdin });

    // Don't let readline keep the process alive — SSE controls lifecycle
    rl.on("close", () => {
      log("stdin closed (bridge continues via SSE)");
    });

    rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let cmd: Record<string, unknown>;
      try {
        cmd = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        log(`Invalid JSON: ${trimmed}`);
        return;
      }

      try {
        const result = await handleCommand(cmd);
        emit(result);
      } catch (err) {
        log(
          `Error processing command: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }

  // 5. Reassign cleanup now that all servers are created
  cleanup = () => {
    clearInterval(keepalive);
    sse.stop();
    if (controlServer) controlServer.close();
    if (healthServer) healthServer.close();
  };

  process.on("SIGINT", () => {
    log("Disconnecting...");
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
}
