/**
 * Local config for `ano session …`.
 *
 * Two pieces of state, both kept under the existing XDG config dir
 * (`~/.config/ano/`) so they sit next to `credentials.json`:
 *
 *   • `settings.json.agent_status` — three-state opt-in flag.
 *       "enabled"  → CLI calls the MCP ops and posts a session.
 *       "disabled" → CLI exits silently (no output, no posts). True off.
 *       missing/unset → CLI prints a one-line discovery message to
 *         stderr and exits with no session_id on stdout. The skill
 *         (see ano-skills) gates downstream calls on stdout, so an
 *         "unset" user gets exactly one prompt per Claude Code
 *         session, not continuous noise.
 *
 *   • `sessions/<sha256(cwd)>.json` — per-cwd session_id cache so
 *     `update`/`end` don't need the id passed explicitly.
 *
 * Both files are best-effort: corrupt JSON resets to the default
 * rather than crashing the CLI.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { configDir } from "./config.js";

export type AgentStatusOptIn = "enabled" | "disabled" | "unset";

interface SettingsFile {
  agent_status?: AgentStatusOptIn;
}

interface SessionCacheFile {
  session_id: string;
  workspace_id?: string;
  list_id?: string;
  started_at?: number;
  /** ISO timestamp of when this cache file was written, for debugging. */
  written_at: string;
}

const SETTINGS_FILE = join(configDir(), "settings.json");
const SESSIONS_DIR = join(configDir(), "sessions");

function loadSettings(): SettingsFile {
  if (!existsSync(SETTINGS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, "utf-8")) as SettingsFile;
  } catch {
    return {};
  }
}

function saveSettings(next: SettingsFile): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
}

export function getAgentStatusOptIn(): AgentStatusOptIn {
  const s = loadSettings();
  return s.agent_status ?? "unset";
}

export function setAgentStatusOptIn(value: "enabled" | "disabled"): void {
  const s = loadSettings();
  s.agent_status = value;
  saveSettings(s);
}

// ── Per-cwd session_id cache ────────────────────────────────────────

function cwdHash(cwd: string = process.cwd()): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 32);
}

function sessionCachePath(cwd: string = process.cwd()): string {
  return join(SESSIONS_DIR, `${cwdHash(cwd)}.json`);
}

export function readCachedSession(
  cwd: string = process.cwd(),
): SessionCacheFile | null {
  const path = sessionCachePath(cwd);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SessionCacheFile;
  } catch {
    return null;
  }
}

export function writeCachedSession(
  data: Omit<SessionCacheFile, "written_at">,
  cwd: string = process.cwd(),
): void {
  mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
  const path = sessionCachePath(cwd);
  const file: SessionCacheFile = {
    ...data,
    written_at: new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(file, null, 2), { mode: 0o600 });
}

export function clearCachedSession(cwd: string = process.cwd()): void {
  const path = sessionCachePath(cwd);
  if (existsSync(path)) {
    rmSync(path);
  }
}

// ── Worktree / branch detection helpers ─────────────────────────────

export function detectGitBranch(): string | undefined {
  try {
    const { execSync } =
      require("node:child_process") as typeof import("node:child_process");
    const out = execSync("git rev-parse --abbrev-ref HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

export function detectWorktreeLabel(): string | undefined {
  try {
    const { execSync } =
      require("node:child_process") as typeof import("node:child_process");
    const top = execSync("git rev-parse --show-toplevel", {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    }).trim();
    if (!top) return undefined;
    // Prefix with hostname (best-effort) so multi-machine viewers can
    // tell where each worktree lives.
    let host = "";
    try {
      host = require("node:os").hostname?.() ?? "";
    } catch {
      host = homedir().split("/").slice(-1)[0] ?? "";
    }
    return host ? `${host}:${top}` : top;
  } catch {
    return undefined;
  }
}
