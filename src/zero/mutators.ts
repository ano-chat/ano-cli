/**
 * CLI-side Zero mutators.
 *
 * These are deliberately MINIMAL — they exist to give the daemon's
 * local Zero replica an optimistic preview of writes. The
 * authoritative version of each mutator lives in the monorepo at
 * `packages/shared/src/mutators/`; Zero routes the mutation by NAME
 * (e.g. `channels.update`) so the server's version runs with full
 * auth + cascade logic when the mutation lands.
 *
 * **Why we don't vendor the full server mutator:**
 *   - The server mutator file pulls in `requireWorkspaceRole`,
 *     `ADMIN_PLUS`, branded-ID makers, the `zql` query accessor —
 *     200+ LOC of supporting infrastructure.
 *   - All those helpers run inside `tx.location === "server"`
 *     branches. On the client, they're dead code.
 *   - So the CLI vendors ONLY the argument schema + the optimistic
 *     update line. Server enforces; client previews.
 *
 * **Drift policy:**
 *   - When the monorepo changes a mutator's argument SHAPE (adds a
 *     required field, renames a key, changes a type), the CLI must
 *     update to match in the same release cycle.
 *   - Failure to update produces a server-side rejection that the
 *     CLI surfaces via `mutation.server.then(...).catch(...)` —
 *     loud and visible, never silent corruption.
 *   - Adding NEW mutators server-side doesn't break the CLI; the
 *     CLI just doesn't have access to them until vendored here.
 *
 * Last synced against monorepo mutators: 2026-05-27.
 */
import { defineMutator, defineMutators } from "@rocicorp/zero";
import { z } from "zod";

/**
 * Mirror of the server's `channelsMutators.update` schema in
 * `packages/shared/src/mutators/channels.ts:80-89`.
 *
 * The CLI uses this for `ano channels archive` (sets
 * `is_archived: true`). Other fields are accepted for forward
 * compatibility — if a future CLI command renames a channel or
 * sets a topic, the schema already handles it.
 *
 * Auth note: the SERVER's mutator at the same name enforces admin+
 * or channel-manager role. The CLI optimistic version just applies
 * the change locally; if the server rejects, Zero rolls back the
 * local replica and the CLI surfaces the error via the
 * `mutation.server` promise.
 */
const channelUpdateSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional().nullable(),
  topic: z.string().optional().nullable(),
  is_archived: z.boolean().optional(),
  posting_restriction: z.string().optional(),
  retention_days_override: z.number().optional().nullable(),
});

/**
 * Mirror of `channelMembersMutators.delete` in
 * `packages/shared/src/mutators/channels.ts:333-411`.
 *
 * The CLI uses this for `ano channels member-remove`. The mutator
 * is a SOFT-DELETE — it sets `removed_at` + `removed_by` + clears
 * `is_channel_manager`. Server-side auth enforces self-remove OR
 * admin OR channel manager (and rejects type='space' which goes
 * through the REST endpoint).
 */
const channelMemberDeleteSchema = z.object({
  id: z.string(),
});

/**
 * Mirror of `messagesMutators.insert` argument shape from
 * `packages/shared/src/mutators/messages-cores.ts:35-51`. We only
 * support the BASIC text path here — `kind: "text"`, no
 * attachments, no thread, no payload. Richer paths (attachments,
 * inline replies, mentions) still go through REST until vendored
 * here.
 */
const messageInsertSchema = z.object({
  id: z.string(),
  channel_id: z.string(),
  user_id: z.string(),
  content: z.string(),
  kind: z.string().optional(),
  // The server's `messagePayloadInput` is `z.any().optional().nullable()`,
  // so we mirror that — but the CLI text path doesn't set payload.
  // Kept here only so accidentally-passed payloads from a future
  // command don't fail Zod validation.
  payload: z.any().optional().nullable(),
  mentions: z.array(z.string()).optional().nullable(),
  is_edited: z.boolean().default(false),
  created_at: z.number(),
  updated_at: z.number(),
});

export const cliMutators = defineMutators({
  channels: {
    update: defineMutator(channelUpdateSchema, async ({ tx, args }) => {
      // Optimistic-only. Server's `channelsMutators.update` runs the
      // full auth check (admin+ OR channel manager) + space-type
      // rejection + DM-creator rule when this mutation lands.
      await tx.mutate.channels.update(args);
    }),
  },
  channel_members: {
    delete: defineMutator(
      channelMemberDeleteSchema,
      async ({ tx, args, ctx }) => {
        // Optimistic-only soft-delete. Server's authoritative
        // `channelMembersMutators.delete` enforces admin/manager OR
        // self-remove. CLI just mirrors the optimistic local write
        // the server-side mutator would perform.
        await tx.mutate.channel_members.update({
          id: args.id,
          // is_channel_manager: false,  // Cleared on kick — match
          //   server. Field exists in monorepo schema but not in
          //   our vendored CLI schema (intentional — keeps the
          //   replica narrow). The server still clears it via the
          //   authoritative mutator; our local replica just lags
          //   one tick on that one field. Acceptable.
          removed_at: Date.now(),
          // removed_by: ctx?.sub,  // Same story as is_channel_manager.
        });
        // Reference ctx so eslint/tsc don't flag it unused.
        void ctx;
      },
    ),
  },
  messages: {
    insert: defineMutator(messageInsertSchema, async ({ tx, args }) => {
      // Optimistic-only insert. Server's `messagesMutators.insert`
      // runs the full membership check + post-insert effects
      // (notifications, last_message_at, embedding queue) via the
      // server-mutator extension layer.
      await tx.mutate.messages.insert({
        id: args.id,
        channel_id: args.channel_id,
        user_id: args.user_id,
        content: args.content,
        created_at: args.created_at,
      });
    }),
  },
});

export type CliMutators = typeof cliMutators;
