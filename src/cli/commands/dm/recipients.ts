import { AnoCliError } from "../../../core/errors.js";
import { ExitCode } from "../../types.js";

export interface DmRecipients {
  names: string[];
  ids: string[];
  email?: string;
  total: number;
  isGroup: boolean;
}

/**
 * Normalise repeated option values + comma-separated forms into a clean
 * deduped list. `--to Alice --to Bob`, `--to Alice,Bob`, and commander
 * variadic arrays all collapse to `["Alice", "Bob"]`.
 */
export function normalizeRecipients(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    for (const piece of entry.split(",")) {
      const trimmed = piece.trim();
      if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    }
  }
  return out;
}

export function parseDmRecipients(input: {
  target?: string;
  to?: unknown;
  email?: string;
  userId?: unknown;
}): DmRecipients {
  const names = normalizeRecipients([
    input.target,
    ...normalizeRecipients(input.to),
  ]);
  const ids = normalizeRecipients(input.userId);
  const email = input.email?.trim() || undefined;
  const total = names.length + ids.length + (email ? 1 : 0);

  if (total === 0) {
    throw new AnoCliError(
      "At least one of recipient, --to, --user-id, or --email is required.",
      ExitCode.USAGE,
    );
  }

  const isGroup = total > 1;
  if (isGroup && email) {
    throw new AnoCliError(
      "--email is only supported for 1:1 DMs. For group DMs, use --to or --user-id.",
      ExitCode.USAGE,
    );
  }

  return { names, ids, email, total, isGroup };
}

export function parseDmLimit(raw: unknown): number {
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AnoCliError(
      "--limit must be an integer from 1 to 100.",
      ExitCode.USAGE,
    );
  }
  return limit;
}

export function toDmRequest(recipients: DmRecipients): {
  recipient_name?: string;
  recipient_email?: string;
  user_id?: string;
  recipient_names?: string[];
  user_ids?: string[];
} {
  if (recipients.isGroup) {
    return {
      recipient_names: recipients.names,
      user_ids: recipients.ids,
    };
  }
  return {
    recipient_name: recipients.names[0],
    recipient_email: recipients.email,
    user_id: recipients.ids[0],
  };
}
