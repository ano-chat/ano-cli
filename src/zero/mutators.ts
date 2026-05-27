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

export const cliMutators = defineMutators({
  channels: {
    update: defineMutator(channelUpdateSchema, async ({ tx, args }) => {
      // Optimistic-only. Server's `channelsMutators.update` runs the
      // full auth check (admin+ OR channel manager) + space-type
      // rejection + DM-creator rule when this mutation lands.
      await tx.mutate.channels.update(args);
    }),
  },
});

export type CliMutators = typeof cliMutators;
