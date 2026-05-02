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

// ── Table types ──────────────────────────────────────────────────

export interface TableField {
  id: string;
  name: string;
  type: string;
  options?: unknown;
}

export interface Table {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  prefix?: string;
  field_definitions: TableField[];
  item_count?: number;
}

export interface TableItem {
  id: string;
  display_id?: string;
  fields: Record<string, unknown>;
  is_archived?: boolean;
  created_at?: number;
  updated_at?: number;
}

export interface TableItemComment {
  comment_id: string;
  item_id: string;
}

export interface QueryTableItemsResult {
  items: TableItem[];
  cursor?: string;
  has_more?: boolean;
}

export interface TableFilter {
  field_id: string;
  operator: string;
  value?: string | number | boolean | string[] | null;
}

export interface TableSort {
  field_id: string;
  direction: "asc" | "desc";
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
  listTables(opts?: { workspace_id?: string }): Promise<Table[]>;
  getTable(opts: { table_id: string }): Promise<Table>;
  queryTableItems(opts: {
    table_id: string;
    filters?: TableFilter[];
    sort?: TableSort;
    include_archived?: boolean;
    limit?: number;
    cursor?: string;
  }): Promise<QueryTableItemsResult>;
  createTable(opts: {
    workspace_id?: string;
    name: string;
    description?: string;
    template_type?: "default" | "blank";
    icon?: string;
    color?: string;
    prefix?: string;
  }): Promise<Table>;
  createTableItem(opts: {
    table_id: string;
    fields: Record<string, unknown>;
  }): Promise<{ item_id: string }>;
  updateTableItem(opts: {
    item_id: string;
    fields?: Record<string, unknown>;
    is_archived?: boolean;
  }): Promise<{ item_id: string }>;
  addTableItemComment(opts: {
    item_id: string;
    body: string;
  }): Promise<TableItemComment>;

  // ── Automations (parity with MCP server-tools-automations) ──────────
  automationCompile(opts: { prompt: string; workspace_id?: string }): Promise<{
    compiled: {
      trigger_type: string;
      trigger_config: Record<string, unknown>;
      actions: Array<{ tool: string; args: Record<string, unknown> }>;
      name: string;
      sender_kind?: string;
      coworker_id?: string;
      bot_avatar?: string;
    };
    warnings: Array<{ step: number; code: string; message: string }>;
  }>;
  automationCreateCompiled(opts: {
    workspace_id?: string;
    name: string;
    trigger_type: string;
    trigger_config?: Record<string, unknown>;
    actions: Array<{ tool: string; args: Record<string, unknown> }>;
    visibility?: "personal" | "workspace";
    sender_kind?: "bot" | "coworker" | "human";
    coworker_id?: string;
    bot_avatar?: string;
    prompt?: string;
  }): Promise<{
    id: string;
    name: string;
    trigger_type: string;
    status: string;
  }>;
  automationCreateFromText(opts: {
    prompt: string;
    workspace_id?: string;
    visibility?: "personal" | "workspace";
  }): Promise<{
    id: string;
    name: string;
    trigger_type: string;
    status: string;
    warnings?: unknown[];
  }>;
  automationList(opts: { workspace_id?: string }): Promise<{
    automations: Array<{
      id: string;
      name: string;
      description?: string;
      trigger_type: string;
      status: string;
      enabled: boolean;
      visibility: string;
      run_count: number;
    }>;
  }>;
  automationRuns(opts: { automation_id: string; limit?: number }): Promise<{
    runs: Array<{
      id: string;
      version: number;
      started_at: string;
      finished_at?: string;
      status: string;
      duration_ms?: number;
      error?: string;
    }>;
  }>;
  automationPause(opts: {
    automation_id: string;
    enabled: boolean;
  }): Promise<{ id: string; name: string; enabled: boolean }>;
  automationDelete(opts: {
    automation_id: string;
  }): Promise<{ id: string; deleted: string }>;
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
    listTables: (opts) => post("/list_tables", opts ?? {}),
    getTable: (opts) => post("/get_table", opts),
    queryTableItems: (opts) => post("/query_table_items", opts),
    createTable: (opts) => post("/create_table", opts),
    createTableItem: (opts) => post("/create_table_item", opts),
    updateTableItem: (opts) => post("/update_table_item", opts),
    addTableItemComment: (opts) => post("/add_table_item_comment", opts),

    automationCompile: (opts) => post("/automation_compile", opts),
    automationCreateCompiled: (opts) =>
      post("/automation_create_compiled", opts as Record<string, unknown>),
    automationCreateFromText: (opts) =>
      post("/automation_create_from_text", opts as Record<string, unknown>),
    automationList: (opts) => post("/automation_list", opts),
    automationRuns: (opts) => post("/automation_runs", opts),
    automationPause: (opts) => post("/automation_pause", opts),
    automationDelete: (opts) => post("/automation_delete", opts),
  };
}

async function handleHttpError(res: Response): Promise<never> {
  const text = await res.text().catch(() => "");
  if (res.status === 401) throw new AuthError("Invalid or expired API key");
  if (res.status === 403)
    throw new AuthError("Insufficient permissions", ExitCode.FORBIDDEN);
  if (res.status === 404) throw new NotFoundError(text || "Not found");
  if (res.status === 429) throw new RateLimitError("Rate limit exceeded");
  throw new ApiError(text || `HTTP ${res.status}`, res.status);
}

function handlePermanentError(err: PermanentError): never {
  if (err.status === 401) throw new AuthError("Invalid or expired API key");
  if (err.status === 403)
    throw new AuthError("Insufficient permissions", ExitCode.FORBIDDEN);
  if (err.status === 404) throw new NotFoundError("Resource not found");
  if (err.status === 429) throw new RateLimitError("Rate limit exceeded");
  throw new ApiError(`API error: ${err.message}`, err.status);
}
