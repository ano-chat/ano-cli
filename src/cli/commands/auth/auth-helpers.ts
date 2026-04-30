// Helpers shared by `ano auth login` and `ano auth complete`. Both
// commands fetch the user's workspaces, mint a CLI key, save the
// resulting profile, and normalize endpoint URLs in the same way —
// duplicated for v2.1.0, extracted here for v2.2.0 to prevent drift.

import {
  saveGlobalCredentials,
  loadGlobalCredentials,
} from "../../../core/config.js";

export interface WorkspaceRow {
  id: string;
  name: string;
  logo_url?: string | null;
}

export function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

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
  workspaceName: string;
}): void {
  const creds = loadGlobalCredentials() ?? { profiles: {} };
  const normalized = stripTrailingSlash(opts.endpoint);
  creds.profiles[opts.profile] = {
    key: opts.key,
    // Omit the endpoint for the default (prod) host so the profile stays
    // endpoint-agnostic and picks up any future default changes.
    endpoint: normalized === "https://api.ano.dev" ? undefined : normalized,
    workspace_name: opts.workspaceName,
    created_at: new Date().toISOString(),
  };
  saveGlobalCredentials(creds);
}
