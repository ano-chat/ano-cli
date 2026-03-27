/**
 * SSE client with auto-reconnect and Last-Event-ID support.
 * Uses native fetch + ReadableStream (no EventSource dependency needed).
 */

export type SSEEvent = {
  id?: string;
  type: string;
  data: string;
};

export type SSEOptions = {
  url: string;
  headers: Record<string, string>;
  onEvent: (event: SSEEvent) => void;
  onConnect: () => void;
  onError: (err: Error) => void;
  /** Called on 401/403 — credentials are bad, reconnecting is pointless. */
  onUnrecoverable?: (status: number) => void;
};

export type SSEClient = {
  stop: () => void;
  connected: () => boolean;
  lastEventTime: () => number | null;
};

const MIN_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;

export function createSSEClient(options: SSEOptions): SSEClient {
  const { url, headers, onEvent, onConnect, onError, onUnrecoverable } =
    options;
  let lastEventId: string | undefined;
  let retryMs = MIN_RETRY_MS;
  let abortController: AbortController | null = null;
  let stopped = false;
  let isConnected = false;
  let lastEventAt: number | null = null;

  async function connect() {
    if (stopped) return;

    abortController = new AbortController();
    const reqHeaders: Record<string, string> = {
      ...headers,
      Accept: "text/event-stream",
    };
    if (lastEventId) {
      reqHeaders["Last-Event-ID"] = lastEventId;
    }

    try {
      const res = await fetch(url, {
        headers: reqHeaders,
        signal: abortController.signal,
      });

      if (!res.ok) {
        // Unrecoverable auth errors — don't reconnect
        if ((res.status === 401 || res.status === 403) && onUnrecoverable) {
          stopped = true;
          onUnrecoverable(res.status);
          return;
        }
        throw new Error(
          `SSE connection failed: ${res.status} ${res.statusText}`,
        );
      }

      if (!res.body) {
        throw new Error("SSE response has no body");
      }

      // Reset retry on successful connection
      retryMs = MIN_RETRY_MS;
      isConnected = true;
      onConnect();

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Current event being built
      let eventId: string | undefined;
      let eventType = "message";
      let eventData: string[] = [];

      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        // SSE spec: lines separated by \n, \r\n, or \r
        const lines = buffer.split(/\r\n|\r|\n/);
        buffer = lines.pop()!; // Keep incomplete last line in buffer

        for (const line of lines) {
          if (line === "") {
            // Empty line = end of event
            if (eventData.length > 0) {
              const event: SSEEvent = {
                id: eventId,
                type: eventType,
                data: eventData.join("\n"),
              };
              if (eventId) lastEventId = eventId;
              lastEventAt = Date.now();
              onEvent(event);
            }
            // Reset for next event
            eventId = undefined;
            eventType = "message";
            eventData = [];
          } else if (line.startsWith("id: ")) {
            eventId = line.slice(4);
          } else if (line.startsWith("event: ")) {
            eventType = line.slice(7);
          } else if (line.startsWith("data: ")) {
            eventData.push(line.slice(6));
          } else if (line.startsWith(":")) {
            // Comment (keepalive) — ignore
          }
        }
      }
    } catch (err) {
      if (stopped) return;
      if (err instanceof Error && err.name === "AbortError") return;
      onError(err instanceof Error ? err : new Error(String(err)));
    }

    isConnected = false;

    // Reconnect with backoff
    if (!stopped) {
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    }
  }

  function stop() {
    stopped = true;
    isConnected = false;
    abortController?.abort();
  }

  // Start connection
  connect();

  return {
    stop,
    connected: () => isConnected,
    lastEventTime: () => lastEventAt,
  };
}
