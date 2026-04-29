import {
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

/**
 * Short-lived cache for an in-flight OAuth login. Used by `auth login
 * --print-workspaces` (writer) and `auth complete` (reader) to bridge the
 * non-TTY orchestration gap: the orchestrator (e.g. Claude Code) prints the
 * workspace list, asks the user via its own UI, then re-invokes the CLI
 * with the picked workspace_id WITHOUT re-running OAuth.
 *
 * Stored at ~/.config/ano/.session, mode 0o600. 5-minute TTL. Single-shot —
 * `auth complete` deletes it after a successful mint.
 */

const SESSION_TTL_MS = 5 * 60 * 1000;

export interface OAuthSession {
  accessToken: string;
  endpoint: string;
  clientId: string;
  /** Unix epoch ms when the session was created. */
  createdAt: number;
  /** WorkOS user id, if WorkOS returned one — informational only. */
  userId?: string;
}

export function sessionPath(): string {
  return join(homedir(), ".config", "ano", ".session");
}

export function saveSession(session: OAuthSession): void {
  const path = sessionPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(session, null, 2), { mode: 0o600 });
}

export function loadSession(): OAuthSession | null {
  let raw: string;
  try {
    raw = readFileSync(sessionPath(), "utf-8");
  } catch {
    return null;
  }

  let parsed: Partial<OAuthSession>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    typeof parsed.accessToken !== "string" ||
    typeof parsed.endpoint !== "string" ||
    typeof parsed.clientId !== "string" ||
    typeof parsed.createdAt !== "number"
  ) {
    return null;
  }

  if (Date.now() - parsed.createdAt > SESSION_TTL_MS) {
    return null;
  }

  return parsed as OAuthSession;
}

export function deleteSession(): void {
  try {
    unlinkSync(sessionPath());
  } catch {
    // Already gone — fine.
  }
}

/**
 * Refuses to read/write through symlinks. Useful as a sanity assertion
 * before either operation.
 */
export function assertSessionPathSafe(): void {
  let st: ReturnType<typeof statSync> | null = null;
  try {
    // Use lstat to detect symlinks at the path itself.
    st = statSync(sessionPath(), { throwIfNoEntry: false });
  } catch {
    return;
  }
  if (st && st.isSymbolicLink && st.isSymbolicLink()) {
    throw new Error(
      "Refusing to use ~/.config/ano/.session: it is a symbolic link",
    );
  }
}
