/**
 * Named queries for the CLI (mirroring the monorepo's
 * `packages/shared/src/queries/`).
 *
 * Why this exists:
 *
 *   The Zero sync server (`zero-cache`) requires NAMED queries.
 *   It receives a query subscription with `{name, args}`, POSTs to
 *   the configured `ZERO_QUERY_URL` (our
 *   `api-staging.ano.dev/api/zero/query`) where the server's
 *   `mustGetQuery(queries, name)` looks up the matching named query
 *   and runs it. Anonymous legacy queries
 *   (`zero.query.X.where(...)`) hit the server with no name and
 *   get dropped — the replica stays empty.
 *
 *   v2.23.x worked around this by falling back to REST on every
 *   empty Zero result (v2.23.3). v2.24.0 actually wires up named
 *   queries so Zero serves real data and the fallback is rare.
 *
 * How it works:
 *
 *   1. The CLIENT (here) calls `defineQueries({channels: {...}})`
 *      with KEY PATHS matching the server's `queries` registry in
 *      `packages/shared/src/queries/index.ts`. `defineQueries`
 *      derives the query name (`"channels.activeByUser"`) from
 *      the key path.
 *   2. `zero.run(queries.channels.activeByUser(), {type: "complete"})`
 *      registers the subscription and waits for the server's reply.
 *   3. zero-cache forwards the query to the configured
 *      `ZERO_QUERY_URL`, which is our
 *      `server/app-zero-sync-routes.ts:263`'s
 *      `/api/zero/query` handler.
 *   4. Server runs `mustGetQuery(queries, "channels.activeByUser")`,
 *      executes with `ctx.sub` from the JWT, returns ZQL + initial
 *      result.
 *   5. zero-cache materializes the result into our local SQLite
 *      replica.
 *   6. Subsequent `zero.run(...)` calls hit the local replica
 *      (microseconds).
 *
 * Drift policy:
 *
 *   Same as `mutators.ts` — when the monorepo renames a query OR
 *   changes its argument shape, this file must update in lockstep.
 *   The failure mode is loud (server rejects with "unknown query
 *   name") so the bug class can't ship silently.
 *
 * Last synced against monorepo: 2026-05-28.
 */
import { defineQueries, defineQuery, createBuilder } from "@rocicorp/zero";
import { z } from "zod";
import { cliSchema } from "./schema.js";

const zql = createBuilder(cliSchema);

// Channel types that match REST's `listChannels` shape. Mirrors
// `CHANNEL_LIKE_TYPES` from
// `packages/shared/src/queries/channels.ts:8` — the constant the
// server-side query uses to filter the `channels` table.
const CHANNEL_LIKE_TYPES = ["channel"] as const;

/**
 * Channel queries.
 *
 * Names + shapes must match `channelsQueries` in
 * `packages/shared/src/queries/channels.ts`. The client-side body
 * only needs to project the replicated data; the server has the
 * authoritative version.
 */
const channelsQueries = {
  activeByUser: defineQuery(({ ctx }) =>
    zql.channels
      .where("type", "IN", CHANNEL_LIKE_TYPES as readonly string[])
      .where("is_archived", false)
      .whereExists("members", (q) =>
        q
          .where("user_id", (ctx as { sub: string }).sub)
          .where("removed_at", "IS", null),
      ),
  ),
};

/**
 * User queries. Reuses `workspace_members.activeByWorkspace` from
 * the monorepo's queries registry (TODO: confirm exact name).
 *
 * For `ano users list --workspace W`: returns workspace_members
 * rows with `.related("user")`, filtered to active members of the
 * workspace, visible only to the requesting user.
 */
const workspaceMembersQueries = {
  // Name `byWorkspace` matches `queries.workspace_members.byWorkspace`
  // in the monorepo (`packages/shared/src/queries/members.ts:25`).
  byWorkspace: defineQuery(z.string(), ({ args: workspaceId }) =>
    // Cast: Zod's inferred args type widens to `ReadonlyJSONValue`
    // but the .where()'s overload expects `string` for this column.
    // Zod has already validated it; the cast is shape-safe.
    zql.workspace_members
      .where("workspace_id", workspaceId as string)
      .where("removed_at", "IS", null)
      .related("user"),
  ),
};

export const cliQueries = defineQueries({
  channels: channelsQueries,
  workspace_members: workspaceMembersQueries,
});

export type CliQueries = typeof cliQueries;
