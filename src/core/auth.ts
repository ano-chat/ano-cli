import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GlobalOptions } from "../cli/types.js";
import { AuthError } from "./errors.js";
import { loadGlobalCredentials, loadProjectConfig } from "./config.js";

export interface ResolvedAuth {
  key: string;
  endpoint: string;
  source: "flag" | "env" | "project" | "global" | "auto-local";
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
        };
      }
    }

    const profile = creds.profiles.default ?? Object.values(creds.profiles)[0];
    if (profile?.key) {
      return {
        key: profile.key,
        endpoint: profile.endpoint ?? globals.endpoint,
        source: "global",
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
 * Walk up from `cwd` looking for `.ano/dev/postgres/postmaster.pid` —
 * the file embedded-postgres writes when `npm run dev:local` brings
 * the local stack up. Returns true on the first ancestor that has it.
 *
 * Cheap (sync stat per ancestor; bounded by filesystem depth). Stops
 * at the filesystem root.
 */
function isUnderRunningDevLocal(cwd: string): boolean {
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
