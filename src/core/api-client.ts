import type { ResolvedAuth } from "./auth.js";
import {
  AuthError,
  NotFoundError,
  RateLimitError,
  NetworkError,
  ApiError,
} from "./errors.js";
import { ExitCode } from "../cli/types.js";
import { retryFetch, PermanentError } from "../bridge/retry.js";

// ── Response types ────────────────────────────────────────────────

export interface Channel {
  id: string;
  name: string;
  type: string;
  topic?: string;
  is_private?: boolean;
}

export interface User {
  id: string;
  display_name: string;
  email?: string;
  avatar_url?: string;
}

export interface Message {
  id: string;
  sender: { name: string; id?: string };
  content: string;
  timestamp: number;
  channel?: string;
}

export interface Workspace {
  id: string;
  name: string;
  logo_url?: string;
}

export interface ContextResponse {
  user: {
    id: string;
    name: string;
    role: string;
    is_coworker: boolean;
  };
  workspace: {
    id: string;
    name: string;
    member_count: number;
  };
  channels: Channel[];
  members: User[];
}

export interface SendResult {
  ok: boolean;
  message_id: string;
  channel_id: string;
  thread_id?: string;
}

export interface SendDmResult {
  ok: boolean;
  message_id: string;
  channel_id: string;
  recipient: string;
}

// ── Client ────────────────────────────────────────────────────────

export interface AnoApiClient {
  context(opts?: { workspace_id?: string }): Promise<ContextResponse>;
  listWorkspaces(): Promise<{ workspaces: Workspace[] }>;
  listChannels(opts?: {
    workspace_id?: string;
  }): Promise<{ channels: Channel[] }>;
  listUsers(opts?: { workspace_id?: string }): Promise<{ users: User[] }>;
  readMessages(opts: {
    channel_id: string;
    limit?: number;
  }): Promise<{ messages: Message[] }>;
  searchMessages(opts: {
    query: string;
    workspace_id?: string;
    limit?: number;
  }): Promise<{ messages: Message[] }>;
  sendMessage(opts: {
    channel_id: string;
    content: string;
    thread_id?: string;
    mentions?: string[];
  }): Promise<SendResult>;
  sendDm(opts: {
    recipient_name?: string;
    recipient_email?: string;
    user_id?: string;
    content: string;
    workspace_id?: string;
  }): Promise<SendDmResult>;
  typing(opts: { channel_id: string }): Promise<{ ok: boolean }>;
}

export function createApiClient(auth: ResolvedAuth): AnoApiClient {
  const { key, endpoint } = auth;

  const authHeader = { Authorization: `Bearer ${key}` };

  async function post<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    try {
      const res = await retryFetch(`${endpoint}/mcp${path}`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return handleHttpError(res);
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof PermanentError) return handlePermanentError(err);
      if (
        err instanceof AuthError ||
        err instanceof NotFoundError ||
        err instanceof RateLimitError ||
        err instanceof ApiError
      )
        throw err;
      throw new NetworkError(`Connection failed: ${(err as Error).message}`);
    }
  }

  async function get<T>(
    path: string,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${endpoint}/mcp${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) url.searchParams.set(k, v);
      }
    }
    try {
      const res = await retryFetch(url.toString(), { headers: authHeader });
      if (!res.ok) return handleHttpError(res);
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof PermanentError) return handlePermanentError(err);
      if (
        err instanceof AuthError ||
        err instanceof NotFoundError ||
        err instanceof RateLimitError ||
        err instanceof ApiError
      )
        throw err;
      throw new NetworkError(`Connection failed: ${(err as Error).message}`);
    }
  }

  return {
    context: (opts) =>
      get(
        "/context",
        opts?.workspace_id ? { workspace_id: opts.workspace_id } : undefined,
      ),
    listWorkspaces: () => post("/list_workspaces", {}),
    listChannels: (opts) => post("/list_channels", opts ?? {}),
    listUsers: (opts) => post("/list_users", opts ?? {}),
    readMessages: (opts) => post("/read_messages", opts),
    searchMessages: (opts) => post("/search_messages", opts),
    sendMessage: (opts) => post("/send_message", opts),
    sendDm: (opts) => post("/send_dm", opts),
    typing: (opts) => post("/typing", opts),
  };
}

async function handleHttpError(res: Response): Promise<never> {
  const text = await res.text().catch(() => "");
  if (res.status === 401)
    throw new AuthError("Invalid or expired API key");
  if (res.status === 403)
    throw new AuthError("Insufficient permissions", ExitCode.FORBIDDEN);
  if (res.status === 404) throw new NotFoundError(text || "Not found");
  if (res.status === 429) throw new RateLimitError("Rate limit exceeded");
  throw new ApiError(text || `HTTP ${res.status}`, res.status);
}

function handlePermanentError(err: PermanentError): never {
  if (err.status === 401)
    throw new AuthError("Invalid or expired API key");
  if (err.status === 403)
    throw new AuthError("Insufficient permissions", ExitCode.FORBIDDEN);
  if (err.status === 404)
    throw new NotFoundError("Resource not found");
  if (err.status === 429) throw new RateLimitError("Rate limit exceeded");
  throw new ApiError(`API error: ${err.message}`, err.status);
}
