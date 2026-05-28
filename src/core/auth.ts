import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GlobalOptions } from "../cli/types.js";
import { AuthError } from "./errors.js";
import { loadGlobalCredentials, loadProjectConfig } from "./config.js";

export interface ResolvedAuth {
  key: string;
  endpoint: string;
  source: "flag" | "env" | "project" | "global" | "auto-local";
  /**
   * Display name of the workspace pinned to the selected credential
   * (only present for `global` / `auto-local` sources — `ano workspaces
   * use` writes it to the profile in `credentials.json`). Surfaced via
   * `ano auth status --agent` so agents can name the workspace without
   * an extra `ano context` round-trip.
   */
  workspace_name?: string;
}

/**
 * Resolve auth credentials through a priority chain:
 * 1. --key flag
 * 2. ANO_API_KEY env
 * 3. .ano/config.json (project)
 * 4. ~/.config/ano/credentials.json
 *    a. --profile / ANO_PROFILE (explicit, errors if missing)
 *    b. AUTO-LOCAL — when CWD is inside a directory with a running
 *       `dev:local` Postgres (an `.ano/dev/postgres/postmaster.pid`
 *       marker), AND a `local` profile exists, prefer it. Prevents
 *       agent-driven sends accidentally landing in staging while the
 *       dev is running the local stack. Disable with ANO_NO_AUTO_LOCAL=1.
 *    c. `default` (or first) profile.
 */
export function resolveAuth(globals: GlobalOptions): ResolvedAuth {
  if (globals.key) {
    return { key: globals.key, endpoint: globals.endpoint, source: "flag" };
  }

  const envKey = process.env.ANO_API_KEY;
  if (envKey) {
    return { key: envKey, endpoint: globals.endpoint, source: "env" };
  }

  const project = loadProjectConfig();
  if (project?.key) {
    return {
      key: project.key,
      endpoint: project.endpoint ?? globals.endpoint,
      source: "project",
    };
  }

  const creds = loadGlobalCredentials();
  if (creds) {
    // Explicit --profile / ANO_PROFILE: must exist; never fall through.
    if (globals.profile) {
      const named = creds.profiles[globals.profile];
      if (!named?.key) {
        const available = Object.keys(creds.profiles).join(", ") || "(none)";
        throw new AuthError(
          `Profile '${globals.profile}' not found. Available: ${available}. Run \`ano auth login --profile ${globals.profile} ...\` to create it.`,
        );
      }
      return {
        key: named.key,
        endpoint: named.endpoint ?? globals.endpoint,
        source: "global",
        workspace_name: named.workspace_name,
      };
    }

    // Auto-local: CWD is inside a monorepo with a running dev:local stack.
    if (!isEnvFlagSet("ANO_NO_AUTO_LOCAL")) {
      const local = creds.profiles.local;
      if (local?.key && isUnderRunningDevLocal(process.cwd())) {
        if (!isEnvFlagSet("ANO_QUIET_PROFILE_HINT")) {
          process.stderr.write(
            "→ profile: local (auto — dev:local stack detected; pass --profile default to override)\n",
          );
        }
        return {
          key: local.key,
          endpoint: local.endpoint ?? globals.endpoint,
          source: "auto-local",
          workspace_name: local.workspace_name,
        };
      }
    }

    const profile = creds.profiles.default ?? Object.values(creds.profiles)[0];
    if (profile?.key) {
      return {
        key: profile.key,
        endpoint: profile.endpoint ?? globals.endpoint,
        source: "global",
        workspace_name: profile.workspace_name,
      };
    }
  }

  throw new AuthError("No API key found. Run `ano auth login` or pass --key");
}

/**
 * Match the project-wide convention for boolean env vars: accept both
 * "1" and "true" (case-insensitive). Mirrors `shouldBypass` in
 * `src/daemon/client.ts`.
 */
function isEnvFlagSet(name: string): boolean {
  const v = process.env[name];
  if (!v) return false;
  const lower = v.toLowerCase();
  return lower === "1" || lower === "true";
}

/**
 * Resolve which profile the DAEMON should bootstrap from. Mirrors
 * `resolveAuth`'s profile-picking chain minus the `--key`/`--profile`
 * CLI flags (the daemon doesn't have access to those):
 *
 *   1. `ANO_PROFILE` env (explicit; errors silently if missing)
 *   2. `.ano/config.json` project key/endpoint (cwd-anchored)
 *   3. Auto-local — when cwd is under a running `dev:local` Postgres
 *      AND a `local` profile exists, prefer it. Same gate as the CLI
 *      client; disable with `ANO_NO_AUTO_LOCAL=1`.
 *   4. `default` (or first) profile from global credentials.
 *
 * Returns `{ key, endpoint }` on success, both `undefined` on miss
 * (caller falls back to whatever — daemon currently skips Zero
 * bootstrap entirely in that case).
 *
 * The daemon was previously hardcoded to `profiles.default`, so a
 * user running `dev:local` from the monorepo would see CLI calls
 * print "profile: local (auto)" but the daemon's Zero + HTTP
 * keepalive would still target staging. `ano channels list` returned
 * staging data while `users list` showed local — the cross-env data
 * leak that this function exists to prevent.
 */
export function resolveBootstrapProfile(cwd: string): {
  key?: string;
  endpoint?: string;
} {
  // 1. Explicit ANO_PROFILE.
  const explicitName = process.env.ANO_PROFILE;
  if (explicitName) {
    const creds = loadGlobalCredentials();
    const named = creds?.profiles[explicitName];
    if (named?.key) {
      return { key: named.key, endpoint: named.endpoint };
    }
    // Explicit-but-missing: don't fall through, let caller skip
    // bootstrap rather than silently pick the wrong profile.
    return {};
  }

  // 2. Project config (cwd-anchored).
  const project = loadProjectConfig();
  if (project?.key && project?.endpoint) {
    return { key: project.key, endpoint: project.endpoint };
  }

  const creds = loadGlobalCredentials();
  if (!creds) return {};

  // 3. Auto-local — only when there IS a `local` profile to pick.
  if (!isEnvFlagSet("ANO_NO_AUTO_LOCAL")) {
    const local = creds.profiles.local;
    if (local?.key && isUnderRunningDevLocal(cwd)) {
      return { key: local.key, endpoint: local.endpoint };
    }
  }

  // 4. Default profile.
  const profile = creds.profiles.default ?? Object.values(creds.profiles)[0];
  return { key: profile?.key, endpoint: profile?.endpoint };
}

/**
 * Walk up from `cwd` looking for `.ano/dev/postgres/postmaster.pid` —
 * the file embedded-postgres writes when `npm run dev:local` brings
 * the local stack up. Returns true on the first ancestor that has it.
 *
 * Cheap (sync stat per ancestor; bounded by filesystem depth). Stops
 * at the filesystem root.
 *
 * Exported for daemon use — the daemon needs the same auto-local
 * detection at bootstrap time so its Zero + REST keepalive bind to
 * the right environment.
 */
export function isUnderRunningDevLocal(cwd: string): boolean {
  let dir = cwd;
  // Cap at 32 levels just in case of pathological symlinks.
  for (let i = 0; i < 32; i++) {
    if (existsSync(join(dir, ".ano", "dev", "postgres", "postmaster.pid"))) {
      return true;
    }
    const parent = dirname(dir);
    if (parent === dir) return false; // hit "/"
    dir = parent;
  }
  return false;
}
