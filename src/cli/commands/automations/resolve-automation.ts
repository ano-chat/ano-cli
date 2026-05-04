/**
 * Shared helper for `ano automation <verb> <slug-or-id>` commands.
 *
 * Lists the workspace's automations once, then resolves the user's
 * input against either a raw UUID or a derived slug. On miss / collision
 * prints a friendly error and exits non-zero so each call site doesn't
 * have to reinvent the same UX.
 *
 * Cost: one extra API round-trip per command — `ano automation pause
 * quiet-otter-42` does a list before the pause. The list endpoint is
 * cheap and the resolution is per-invocation; if this ever becomes a
 * hot path we can add a cached form. For now the simplicity wins.
 *
 * Acceptable inputs:
 *   - bare UUID                              (back-compat — fast path)
 *   - slug like `quiet-otter-42`             (new — preferred)
 *   - whitespace around either               (trimmed)
 */
import type { AnoApiClient } from "../../../core/api-client.js";
import { resolveSlugOrId, slugFromId } from "../../../util/slug.js";
import { red, dim, bold } from "../../../util/colors.js";

interface ResolveDeps {
  client: AnoApiClient;
  workspace?: string;
  /** Caller-supplied positional — already raw input from commander. */
  input: string;
  /** Surface label used in error messages ("automation"). */
  label?: string;
}

/**
 * Returns the resolved UUID. Prints + exits on error so the caller
 * can `const id = await resolveAutomation(...)` and use `id` directly
 * with the existing API client surfaces.
 */
export async function resolveAutomation({
  client,
  workspace,
  input,
  label = "automation",
}: ResolveDeps): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed) {
    process.stderr.write(red(`error: missing ${label} (slug or UUID)\n`));
    process.exit(2);
  }

  const result = await client.automationList({ workspace_id: workspace });
  const automations = result.automations;
  const resolved = resolveSlugOrId(trimmed, automations);

  if (resolved.ok) return resolved.match.id;

  if (resolved.reason === "ambiguous") {
    process.stderr.write(
      red(`error: ${trimmed} matches more than one ${label}:\n`),
    );
    for (const m of resolved.matches) {
      process.stderr.write(
        `  ${dim(slugFromId(m.id))}  ${dim(m.id)}  ${(m as { name?: string }).name ?? ""}\n`,
      );
    }
    process.stderr.write(dim("Use the full UUID to pick one unambiguously.\n"));
    process.exit(2);
  }

  // not_found — give the user a hand by printing nearby slugs.
  process.stderr.write(red(`error: no ${label} matches ${bold(trimmed)}\n`));
  if (automations.length === 0) {
    process.stderr.write(dim(`The workspace has no automations yet.\n`));
  } else {
    process.stderr.write(dim(`Available:\n`));
    for (const a of automations.slice(0, 10)) {
      const name = (a as { name?: string }).name ?? "";
      process.stderr.write(`  ${dim(slugFromId(a.id))}  ${name}\n`);
    }
    if (automations.length > 10) {
      process.stderr.write(
        dim(
          `  …and ${automations.length - 10} more (run \`ano automation list\`).\n`,
        ),
      );
    }
  }
  process.exit(2);
}
