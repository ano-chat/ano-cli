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
    /** Optional run cap; null/absent = unlimited. */
    max_runs?: number | null;
    /** Optional expiry epoch ms; null/absent = no expiry. */
    expires_at?: number | null;
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
  /**
   * Flip a webhook-triggered automation from `stub` → `active` so
   * inbound webhook POSTs actually fire the configured actions
   * instead of being recorded for inspection. The mint endpoint
   * always creates new tokens in stub mode (intentional, for the
   * desktop UI's recompile-on-real-payload flow); CLI users who
   * already wrote the automation themselves typically want to
   * activate immediately.
   */
  automationActivate(opts: { automation_id: string }): Promise<{ ok: boolean }>;
  automationRun(opts: { automation_id: string; dry_run?: boolean }): Promise<{
    dry_run: boolean;
    automation?: { id: string; name: string; status: string };
    would_execute?: Array<{
      step: number;
      tool: string;
      args: Record<string, unknown>;
    }>;
    ok?: boolean;
    runId?: string;
    error?: string;
  }>;
  automationUpdate(opts: {
    automation_id: string;
    name?: string;
    description?: string;
    trigger_type?:
      | "schedule"
      | "message_match"
      | "mention"
      | "channel_event"
      | "webhook";
    trigger_config?: Record<string, unknown>;
    actions?: Array<{ tool: string; args: Record<string, unknown> }>;
    visibility?: "personal" | "workspace";
    enabled?: boolean;
    /** Run cap; null = remove cap. */
    max_runs?: number | null;
    /** Expiry epoch ms; null = remove expiry. */
    expires_at?: number | null;
  }): Promise<{
    id: string;
    name: string;
    trigger_type: string;
    enabled: boolean;
    status: string;
  }>;
  automationWebhookSetup(opts: { automation_id: string }): Promise<{
    url: string;
    secret: string;
    signature_header: string;
    timestamp_header: string;
    signing_format: string;
    notes: string;
  }>;
  automationValidate(opts: { plan: unknown; workspace_id?: string }): Promise<{
    ok: boolean;
    schema_errors: unknown[];
    warnings: Array<{
      step: number;
      code: string;
      message: string;
      hint?: string;
    }>;
    trigger_type?: string;
  }>;
  webhookTest(opts: { coworker_id: string; workspace_id?: string }): Promise<{
    ok: boolean;
    url: string;
    status: number;
    latency_ms: number;
    response_preview: string;
    signature_header: string;
    timestamp_header: string;
    error?: string;
  }>;
  channelCreate(opts: {
    name: string;
    workspace_id?: string;
    topic?: string;
    description?: string;
    is_private?: boolean;
    type?: "channel" | "space";
    member_ids?: string[];
  }): Promise<{
    id: string;
    name: string;
    is_private: boolean;
    type: string;
    member_count: number;
  }>;
  inviteUser(opts: {
    workspace_id?: string;
    invited_email?: string;
    expires_in_hours?: number;
  }): Promise<{
    token: string;
    invite_url: string;
    expires_at: string;
    workspace_id: string;
    invited_email: string | null;
  }>;
  coworkerCreate(opts: {
    display_name: string;
    workspace_id?: string;
    role_title: string;
    avatar_url?: string;
    expertise?: string;
    personality?: string;
    boundaries?: string;
    custom_instructions?: string;
    model_provider?: string;
    model_id?: string;
    allowed_skill_slugs?: string[];
    allowed_tool_scope?: "all" | "internal_only" | "custom" | "capabilities";
    allowed_tools?: string[];
    capabilities?: string[];
    respond_to_mentions?: boolean;
    respond_to_dms?: boolean;
    channel_ids?: string[];
    mode?: "managed" | "external";
    webhook_url?: string;
  }): Promise<{
    id: string;
    display_name: string;
    api_key?: string;
    webhook_secret?: string;
  }>;
  channelArchive(opts: {
    channel_id: string;
    workspace_id?: string;
  }): Promise<{ id: string; name: string; is_archived: boolean }>;
  channelMemberAdd(opts: {
    channel_id: string;
    user_id: string;
    workspace_id?: string;
  }): Promise<{ id: string; channel_id: string; user_id: string }>;
  channelMemberRemove(opts: {
    channel_id: string;
    user_id: string;
    workspace_id?: string;
  }): Promise<{ channel_id: string; user_id: string; removed_at: string }>;
  workspaceMemberAdd(opts: { workspace_id: string; user_id: string }): Promise<{
    workspace_id: string;
    user_id: string;
    already_member: boolean;
    promoted_from_collaborator: boolean;
    rejoined: boolean;
  }>;
  workspaceMemberRemove(opts: {
    workspace_id: string;
    user_id: string;
  }): Promise<{ workspace_id: string; user_id: string; removed_at: string }>;
  dndSet(opts: {
    enabled: boolean;
    start_time?: string;
    end_time?: string;
    until?: string | null;
  }): Promise<{
    user_id: string;
    enabled: boolean;
    start_time: string | null;
    end_time: string | null;
    until: string | null;
  }>;
  notificationPreferencesSet(opts: {
    workspace_id?: string;
    global_level?: "everything" | "mentions_dms" | "nothing";
    email_enabled?: boolean;
    email_delay_minutes?: number;
    desktop_enabled?: boolean;
    mobile_enabled?: boolean;
  }): Promise<{
    user_id: string;
    workspace_id: string;
    global_level: string;
    email_enabled: boolean;
    email_delay_minutes: number;
    desktop_enabled: boolean;
    mobile_enabled: boolean;
  }>;

  // ── Integrations (Pipedream Connect URL flow) ───────────────────────
  requestConnection(opts: { app: string; workspace_id?: string }): Promise<{
    auth_url: string;
    expires_at: string;
    workspace_id: string;
    expected_connection_name: string;
    instructions?: string;
  }>;
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
    automationRun: (opts) =>
      post("/automation_run", opts as Record<string, unknown>),
    automationPause: (opts) => post("/automation_pause", opts),
    automationDelete: (opts) => post("/automation_delete", opts),
    automationActivate: (opts) => post("/automation_activate", opts),
    automationUpdate: (opts) =>
      post("/automation_update", opts as Record<string, unknown>),
    automationWebhookSetup: (opts) => post("/automation_webhook_setup", opts),
    automationValidate: (opts) =>
      post("/automation_validate", opts as Record<string, unknown>),
    webhookTest: (opts) => post("/webhook_test", opts),
    coworkerCreate: (opts) =>
      post("/coworker_create", opts as Record<string, unknown>),
    channelCreate: (opts) =>
      post("/channel_create", opts as Record<string, unknown>),
    inviteUser: (opts) => post("/invite_user", opts as Record<string, unknown>),
    channelArchive: (opts) => post("/channel_archive", opts),
    channelMemberAdd: (opts) => post("/channel_member_add", opts),
    channelMemberRemove: (opts) => post("/channel_member_remove", opts),
    workspaceMemberAdd: (opts) => post("/workspace_member_add", opts),
    workspaceMemberRemove: (opts) => post("/workspace_member_remove", opts),
    dndSet: (opts) => post("/dnd_set", opts as Record<string, unknown>),
    notificationPreferencesSet: (opts) =>
      post("/notification_preferences_set", opts as Record<string, unknown>),
    requestConnection: (opts) => post("/request_connection", opts),
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
