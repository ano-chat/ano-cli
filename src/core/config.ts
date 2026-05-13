import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

/**
 * Resolved per-call, NOT cached at module load. Critical for the
 * daemon: when it dispatches a request from a process whose HOME is
 * redirected (e.g. the Ano in-app PTY shell with HOME=
 * `~/.ano/dev/shell-home`), the daemon's `dispatch()` temporarily
 * replaces `process.env` with the caller's env. A cached `CONFIG_DIR`
 * would still point at the daemon's startup HOME and read the wrong
 * credentials file. v2.16.2 regression fix.
 */
function resolveConfigDir(): string {
  return join(homedir(), ".config", "ano");
}
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
  return resolveConfigDir();
}

export function loadGlobalCredentials(): Credentials | null {
  return loadJson<Credentials>(join(resolveConfigDir(), "credentials.json"));
}

export function saveGlobalCredentials(creds: Credentials): void {
  const dir = resolveConfigDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "credentials.json"), JSON.stringify(creds, null, 2), {
    mode: 0o600,
  });
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
