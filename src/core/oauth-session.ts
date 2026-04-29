import {
  closeSync,
  constants as fsConstants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
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
 *
 * Holds a WorkOS access token, so it gets the same hardening as
 * credentials.json: lstat guard against pre-existing symlinks and an
 * atomic open(O_NOFOLLOW|O_EXCL) → write → fsync → rename pattern.
 */

const SESSION_TTL_MS = 5 * 60 * 1000;

export interface OAuthSession {
  accessToken: string;
  endpoint: string;
  clientId: string;
  /** Unix epoch ms when the session was created. */
  createdAt: number;
  /**
   * WorkOS user id, if WorkOS returned one. Informational only — `auth
   * complete` doesn't validate against this; it re-fetches workspaces and
   * checks membership of the picked id.
   */
  userId?: string;
}

export function sessionPath(): string {
  return join(homedir(), ".config", "ano", ".session");
}

/**
 * Refuse to operate on the session path if it (or its tmp sibling) is a
 * symlink. Defends against a pre-seeded symlink-to-canary attack where an
 * attacker arranges for our write to clobber an unrelated file owned by
 * the same user.
 *
 * NOTE: uses lstatSync (not statSync) so the symlink itself is inspected
 * rather than its target.
 */
export function assertSessionPathSafe(): void {
  for (const p of [sessionPath(), sessionPath() + ".tmp"]) {
    let st;
    try {
      st = lstatSync(p);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw e;
    }
    if (st.isSymbolicLink()) {
      throw new Error(
        `Refusing to use ${p}: it is a symbolic link (potential symlink attack)`,
      );
    }
  }
}

export function saveSession(session: OAuthSession): void {
  const path = sessionPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  assertSessionPathSafe();
  atomicWriteSecret(path, JSON.stringify(session, null, 2));
}

export function loadSession(): OAuthSession | null {
  // Refuse to read through a symlink — protects against a canary-swap
  // where an attacker replaces ~/.config/ano/.session with a symlink to
  // a file they want us to leak the contents of via an error message.
  try {
    assertSessionPathSafe();
  } catch {
    return null;
  }

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
 * Atomic, symlink-safe write of a secret value to `targetPath`.
 *
 * Why not fs.writeFileSync(target, data, { mode: 0o600 }):
 *   - `writeFileSync` follows symlinks. An attacker who arranges for the
 *     target (or a `.tmp` sibling we write to first) to be a symlink to,
 *     say, ~/.ssh/authorized_keys would have us clobber that file with
 *     our content.
 *
 * Defenses applied here:
 *   - O_EXCL on the .tmp open: rejects a pre-existing .tmp parked by an
 *     attacker.
 *   - O_NOFOLLOW on the .tmp open: rejects a symlink at the .tmp path.
 *   - Any leftover .tmp from a prior crash is removed first, but only
 *     after lstat-confirming it's a regular file (not a symlink).
 *   - fsync before rename so a power loss doesn't leave a half-written
 *     file under the target name.
 */
function atomicWriteSecret(targetPath: string, data: string): void {
  const tmp = targetPath + ".tmp";

  // Clean up any stale .tmp from a crashed prior run, but reject symlinks.
  try {
    const st = lstatSync(tmp);
    if (st.isSymbolicLink()) {
      throw new Error(
        `Refusing to write: ${tmp} is a symbolic link (potential symlink attack)`,
      );
    }
    unlinkSync(tmp);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  const flags =
    fsConstants.O_WRONLY |
    fsConstants.O_CREAT |
    fsConstants.O_EXCL |
    fsConstants.O_NOFOLLOW;
  const fd = openSync(tmp, flags, 0o600);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, targetPath);
}
