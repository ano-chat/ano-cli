import type { GlobalOptions } from "../cli/types.js";
import { AuthError } from "./errors.js";
import { loadGlobalCredentials, loadProjectConfig } from "./config.js";

export interface ResolvedAuth {
  key: string;
  endpoint: string;
  source: "flag" | "env" | "project" | "global";
}

/**
 * Resolve auth credentials through a priority chain:
 * 1. --key flag
 * 2. ANO_API_KEY env
 * 3. .ano/config.json (project)
 * 4. ~/.config/ano/credentials.json (global, default profile)
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
