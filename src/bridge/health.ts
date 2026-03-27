/**
 * Minimal health server for ano-connect.
 * Responds to GET /healthz with SSE connection status.
 */
import { createServer, type Server } from "node:http";

export type HealthState = {
  connected: () => boolean;
  lastEventTime: () => number | null;
  workspace: string;
  startedAt: number;
};

export function startHealthServer(
  port: number,
  state: HealthState,
): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      const isConnected = state.connected();
      const lastEvent = state.lastEventTime();
      const uptime = Math.floor((Date.now() - state.startedAt) / 1000);

      const body = JSON.stringify({
        status: isConnected ? "ok" : "error",
        connected: isConnected,
        last_event: lastEvent,
        uptime,
        workspace: state.workspace,
      });

      res.writeHead(isConnected ? 200 : 503, {
        "Content-Type": "application/json",
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  return new Promise<Server>((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve(server);
    });
  });
}
