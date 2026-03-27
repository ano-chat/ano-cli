export interface ParsedAnoUrl {
  type: "workspace" | "channel" | "message";
  workspace?: string;
  channel?: string;
  messageId?: string;
}

export function parseAnoUrl(url: string): ParsedAnoUrl | null {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (host !== "ano.dev" && !host.endsWith(".ano.dev")) return null;

    const parts = u.pathname.split("/").filter(Boolean);

    if (parts.length === 0) return null;
    if (parts.length === 1)
      return { type: "workspace", workspace: parts[0] };
    if (parts.length === 2)
      return {
        type: "channel",
        workspace: parts[0],
        channel: parts[1],
      };
    if (parts.length >= 3)
      return {
        type: "message",
        workspace: parts[0],
        channel: parts[1],
        messageId: parts[2],
      };

    return null;
  } catch {
    return null;
  }
}
