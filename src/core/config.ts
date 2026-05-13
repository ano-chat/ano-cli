import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const CONFIG_DIR = join(homedir(), ".config", "ano");
const PROJECT_DIR = ".ano";

export interface Credentials {
  profiles: Record<
    string,
    {
      key: string;
      endpoint?: string;
      workspace_name?: string;
      /**
       * Active workspace ID for this profile. Set by `ano workspaces use <id>`.
       * Commands that take a workspace_id default to this when neither
       * --workspace-id nor ANO_WORKSPACE_ID is supplied. Leave undefined for
       * single-workspace users.
       */
      workspace_id?: string;
      /**
       * Workspace's home region ("us" | "eu"). Persisted at login from
       * `/cp/workspaces` so subsequent commands know which regional
       * API the workspace lives in without re-querying. Informational
       * today (routing is driven by `endpoint`); useful for future
       * `ano workspaces list --region us` filters.
       */
      region?: "us" | "eu";
      created_at: string;
    }
  >;
}

export interface ProjectConfig {
  key?: string;
  endpoint?: string;
  workspace_id?: string;
  default_channel?: string;
}

export function configDir(): string {
  return CONFIG_DIR;
}

export function loadGlobalCredentials(): Credentials | null {
  return loadJson<Credentials>(join(CONFIG_DIR, "credentials.json"));
}

export function saveGlobalCredentials(creds: Credentials): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(CONFIG_DIR, "credentials.json"),
    JSON.stringify(creds, null, 2),
    { mode: 0o600 },
  );
}

export function loadProjectConfig(): ProjectConfig | null {
  return loadJson<ProjectConfig>(
    join(process.cwd(), PROJECT_DIR, "config.json"),
  );
}

function loadJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}
