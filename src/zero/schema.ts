/**
 * Minimal vendored Zero schema for the CLI.
 *
 * This is a deliberate SUBSET of the full schema defined in the
 * monorepo at `packages/shared/src/schema/index.ts`. We only include
 * the tables + columns the CLI actively reads or writes. Two reasons:
 *
 *  1. **Repo isolation.** The CLI is a separate repo (no
 *     workspace-package link to `@ano/shared`). Adding the full
 *     schema would require either publishing `@ano/shared` to npm
 *     (a 2-3 day infra project) or vendoring the entire shared
 *     package. We're starting small; this file can grow as we
 *     migrate more commands to Zero.
 *  2. **Forward compatibility.** A schema that's a strict SUBSET of
 *     the server's is accepted by zero-cache. Adding new server-side
 *     tables doesn't break CLI clients running with this schema.
 *     The drift cost: when the server REMOVES a column we use, the
 *     CLI breaks until updated. Bounded.
 *
 * Schema-drift policy: when the server schema (monorepo) changes a
 * table/column we vendored here, this file must be updated and the
 * CLI version bumped. There's no automatic sync — that's a
 * follow-up project (publish `@ano/shared` properly).
 *
 * Last synced against monorepo schema: 2026-05-27 (v0.18.0 era).
 */
import {
  table,
  string,
  boolean,
  number,
  createSchema,
  relationships,
} from "@rocicorp/zero";

// ── core identity / membership ─────────────────────────────────────

const users = table("users")
  .columns({
    id: string(),
    email: string(),
    display_name: string(),
    avatar_url: string().optional(),
    handle: string().optional(),
    is_deactivated: boolean(),
    deleted_at: number().optional(),
  })
  .primaryKey("id");

const workspaces = table("workspaces")
  .columns({
    id: string(),
    name: string(),
    slug: string(),
    logo_url: string().optional(),
    region: string(),
    deleted_at: number().optional(),
  })
  .primaryKey("id");

const workspace_members = table("workspace_members")
  .columns({
    id: string(),
    workspace_id: string(),
    user_id: string(),
    role: string(),
    removed_at: number().optional(),
  })
  .primaryKey("id");

// ── channels + memberships ─────────────────────────────────────────

const channels = table("channels")
  .columns({
    id: string(),
    workspace_id: string().optional(),
    name: string(),
    type: string(), // 'channel' | 'dm' | 'space'
    topic: string().optional(),
    is_archived: boolean(),
    is_private: boolean(),
    created_at: number(),
    created_by: string().optional(),
    parent_id: string().optional(),
    deleted_at: number().optional(),
  })
  .primaryKey("id");

const channel_members = table("channel_members")
  .columns({
    id: string(),
    channel_id: string(),
    user_id: string(),
    joined_at: number(),
    removed_at: number().optional(),
  })
  .primaryKey("id");

// ── messages ───────────────────────────────────────────────────────

const messages = table("messages")
  .columns({
    id: string(),
    channel_id: string(),
    user_id: string(),
    content: string(),
    created_at: number(),
    edited_at: number().optional(),
    deleted_at: number().optional(),
    parent_id: string().optional(),
    thread_root_id: string().optional(),
  })
  .primaryKey("id");

// ── relationships (used by .related() in queries) ──────────────────

const usersRel = relationships(users, ({ many }) => ({
  workspaces: many({
    sourceField: ["id"],
    destField: ["user_id"],
    destSchema: workspace_members,
  }),
}));

const workspacesRel = relationships(workspaces, ({ many }) => ({
  members: many({
    sourceField: ["id"],
    destField: ["workspace_id"],
    destSchema: workspace_members,
  }),
  channels: many({
    sourceField: ["id"],
    destField: ["workspace_id"],
    destSchema: channels,
  }),
}));

const channelsRel = relationships(channels, ({ many, one }) => ({
  members: many({
    sourceField: ["id"],
    destField: ["channel_id"],
    destSchema: channel_members,
  }),
  workspace: one({
    sourceField: ["workspace_id"],
    destField: ["id"],
    destSchema: workspaces,
  }),
}));

const channelMembersRel = relationships(channel_members, ({ one }) => ({
  user: one({
    sourceField: ["user_id"],
    destField: ["id"],
    destSchema: users,
  }),
  channel: one({
    sourceField: ["channel_id"],
    destField: ["id"],
    destSchema: channels,
  }),
}));

const messagesRel = relationships(messages, ({ one }) => ({
  author: one({
    sourceField: ["user_id"],
    destField: ["id"],
    destSchema: users,
  }),
  channel: one({
    sourceField: ["channel_id"],
    destField: ["id"],
    destSchema: channels,
  }),
}));

const workspaceMembersRel = relationships(workspace_members, ({ one }) => ({
  user: one({
    sourceField: ["user_id"],
    destField: ["id"],
    destSchema: users,
  }),
  workspace: one({
    sourceField: ["workspace_id"],
    destField: ["id"],
    destSchema: workspaces,
  }),
}));

export const cliSchema = createSchema({
  tables: [
    users,
    workspaces,
    workspace_members,
    channels,
    channel_members,
    messages,
  ],
  relationships: [
    usersRel,
    workspacesRel,
    channelsRel,
    channelMembersRel,
    messagesRel,
    workspaceMembersRel,
  ],
});

export type CliSchema = typeof cliSchema;
