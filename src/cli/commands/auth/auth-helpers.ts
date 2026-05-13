// Helpers shared by `ano auth login` and `ano auth complete`. Both
// commands fetch the user's workspaces, mint a CLI key, save the
// resulting profile, and normalize endpoint URLs in the same way —
// duplicated for v2.1.0, extracted here for v2.2.0 to prevent drift.

import {
  saveGlobalCredentials,
  loadGlobalCredentials,
} from "../../../core/config.js";

export type Region = "us" | "eu";

export interface WorkspaceRow {
  id: string;
  name: string;
  logo_url?: string | null;
  /**
   * Workspace's home region. Optional because the legacy
   * `/api/cli-keys/workspaces` endpoint omits it on older servers;
   * present from `/cp/workspaces` (D1, globally consistent). Callers
   * that mint api_keys MUST honor it — api_keys rows are FK'd to
   * `workspaces(id)` in regional Postgres, so a key for an EU
   * workspace MUST be created against `api-eu.ano.dev`.
   */
  region?: Region;
}

export function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

/**
 * Map a region to its public regional API host. Mirrors the same
 * table the Worker and desktop use.
 */
export function regionalApiUrl(region: Region): string {
  return region === "eu" ? "https://api-eu.ano.dev" : "https://api-us.ano.dev";
}

/**
 * Legacy workspace lister. Hits `/api/cli-keys/workspaces` which is
 * served by the regional Postgres the request lands in — so a
 * cross-region member gets only the workspaces in THIS region. Kept
 * as the fallback for self-hosted / dev endpoints that don't have
 * the `/cp/*` control plane deployed.
 */
export async function listWorkspaces(opts: {
  endpoint: string;
  accessToken: string;
}): Promise<WorkspaceRow[]> {
  const res = await fetch(
    `${stripTrailingSlash(opts.endpoint)}/api/cli-keys/workspaces`,
    {
      headers: { Authorization: `Bearer ${opts.accessToken}` },
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to list workspaces: ${res.status}${text ? ` ${text}` : ""}`,
    );
  }
  const body = (await res.json()) as { workspaces?: WorkspaceRow[] };
  return body.workspaces ?? [];
}

interface CpWorkspaceRow {
  id: string;
  name: string;
  region: Region;
  archivedAt: number | null;
}

/**
 * Cross-region workspace lister via the D1 control plane at
 * `GET /cp/workspaces`. Returns every workspace the caller is an
 * active member of regardless of region — fixes the legacy path's
 * partial-list bug for cross-region members.
 *
 * Returns `null` (not throws) on 404 so callers can fall back to the
 * legacy path. Any other failure (5xx, network, malformed) still
 * throws so the operator notices.
 *
 * Active workspaces only: archived (`archivedAt !== null`) are
 * filtered so the picker doesn't surface retired workspaces.
 */
export async function listWorkspacesGlobal(opts: {
  endpoint: string;
  accessToken: string;
}): Promise<WorkspaceRow[] | null> {
  const res = await fetch(
    `${stripTrailingSlash(opts.endpoint)}/cp/workspaces`,
    {
      headers: { Authorization: `Bearer ${opts.accessToken}` },
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to list workspaces (cp): ${res.status}${text ? ` ${text}` : ""}`,
    );
  }
  const body = (await res.json()) as { workspaces?: CpWorkspaceRow[] };
  return (body.workspaces ?? [])
    .filter((w) => w.archivedAt === null)
    .map((w) => ({
      id: w.id,
      name: w.name,
      logo_url: null,
      region: w.region,
    }));
}

export async function mintCliKey(opts: {
  endpoint: string;
  accessToken: string;
  workspaceId: string;
}): Promise<string> {
  const res = await fetch(`${stripTrailingSlash(opts.endpoint)}/api/cli-keys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspace_id: opts.workspaceId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to mint CLI key: ${res.status}${text ? ` ${text}` : ""}`,
    );
  }
  const body = (await res.json()) as { api_key?: string };
  if (!body.api_key) {
    throw new Error("CLI key response was missing api_key");
  }
  return body.api_key;
}

export function saveProfile(opts: {
  profile: string;
  key: string;
  endpoint: string;
  workspaceId?: string;
  workspaceName: string;
  /**
   * Workspace's home region. Persisted alongside `endpoint` so a
   * future "what region am I on?" question is answerable without
   * re-resolving via the Worker. Today only the regional endpoint
   * URL is load-bearing for routing; `region` is informational.
   */
  region?: Region;
}): void {
  const creds = loadGlobalCredentials() ?? { profiles: {} };
  const normalized = stripTrailingSlash(opts.endpoint);
  creds.profiles[opts.profile] = {
    key: opts.key,
    // Omit the endpoint for the default (prod) host so the profile stays
    // endpoint-agnostic and picks up any future default changes. A
    // resolved regional URL (`api-us`, `api-eu`) is persisted verbatim
    // so the CLI skips the apex hop on every subsequent invocation.
    endpoint: normalized === "https://api.ano.dev" ? undefined : normalized,
    workspace_id: opts.workspaceId,
    workspace_name: opts.workspaceName,
    region: opts.region,
    created_at: new Date().toISOString(),
  };
  saveGlobalCredentials(creds);
}
