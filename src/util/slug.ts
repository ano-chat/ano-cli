/**
 * Stable, human-readable slugs derived from UUIDs.
 *
 * Replaces opaque IDs like `f4b1f964-1613-49b7-af6f-f5d5213692b8` with
 * `quiet-otter-42` in CLI output. Slugs are deterministic — the same
 * UUID always produces the same slug — so we can resolve a slug back
 * to its UUID by searching a list (`resolveSlugOrId`).
 *
 * Format: `<adjective>-<animal>-<2digit>`.
 *   - Wordlist size: 64 adjectives × 64 animals × 100 numbers = 409,600
 *     unique slugs. Collisions across the same workspace's automations
 *     are vanishingly unlikely; if they ever happen the user can fall
 *     back to the raw UUID, which the CLI accepts indefinitely.
 *
 * The slug is display-only — the source-of-truth identifier in the
 * server, schema, URLs, and persistence layers is still the UUID.
 */

// Adjective + animal wordlists chosen to be short, readable, and
// unambiguous. Avoid words that could be misread on a CLI (e.g. `rl`
// vs `r1`) or words that imply ordering ("first", "old", etc).
const ADJECTIVES = [
  "quiet",
  "loud",
  "bold",
  "calm",
  "swift",
  "slow",
  "warm",
  "cool",
  "bright",
  "dark",
  "happy",
  "lucky",
  "wise",
  "brave",
  "kind",
  "fair",
  "fresh",
  "neat",
  "clear",
  "soft",
  "fuzzy",
  "fluffy",
  "shiny",
  "sleek",
  "sharp",
  "smooth",
  "rough",
  "tall",
  "short",
  "tiny",
  "huge",
  "wide",
  "deep",
  "high",
  "low",
  "fast",
  "early",
  "late",
  "rich",
  "free",
  "real",
  "true",
  "new",
  "fine",
  "good",
  "great",
  "epic",
  "noble",
  "merry",
  "jolly",
  "snug",
  "cosy",
  "zesty",
  "spicy",
  "sweet",
  "salty",
  "minty",
  "lemon",
  "berry",
  "honey",
  "amber",
  "azure",
  "rosy",
  "ivory",
] as const;

const ANIMALS = [
  "otter",
  "fox",
  "lynx",
  "wolf",
  "bear",
  "deer",
  "owl",
  "hawk",
  "eagle",
  "raven",
  "robin",
  "finch",
  "swan",
  "duck",
  "crane",
  "heron",
  "seal",
  "whale",
  "orca",
  "dolphin",
  "panda",
  "tiger",
  "puma",
  "leopard",
  "rabbit",
  "hare",
  "mole",
  "squirrel",
  "badger",
  "stoat",
  "weasel",
  "ferret",
  "frog",
  "newt",
  "toad",
  "lizard",
  "gecko",
  "iguana",
  "turtle",
  "tortoise",
  "salmon",
  "trout",
  "perch",
  "carp",
  "shrimp",
  "crab",
  "lobster",
  "octopus",
  "bee",
  "ant",
  "moth",
  "beetle",
  "spider",
  "wasp",
  "cricket",
  "firefly",
  "horse",
  "pony",
  "donkey",
  "yak",
  "llama",
  "alpaca",
  "goat",
  "ram",
] as const;

/**
 * Derive a stable display slug from a UUID. The slug is purely a UI
 * convenience — it is NOT a unique identifier and is NOT stored.
 */
export function slugFromId(id: string): string {
  if (!id) return "";
  // Strip dashes so UUID v4 hex chars become a clean stream. Operate on
  // the bytes so the hash is independent of UUID formatting (with or
  // without dashes, upper or lower case).
  const normalized = id.replace(/-/g, "").toLowerCase();

  // Take three independent slices of the hash for adj / animal /
  // number. Using `parseInt(slice, 16)` is fine because the slices
  // are small (8 hex chars → 32-bit unsigned, well within JS Number
  // precision) and the operation is deterministic across platforms.
  const adjIdx =
    parseInt(normalized.slice(0, 8) || "0", 16) % ADJECTIVES.length;
  const aniIdx = parseInt(normalized.slice(8, 16) || "0", 16) % ANIMALS.length;
  const num = parseInt(normalized.slice(16, 24) || "0", 16) % 100;

  const numStr = num.toString().padStart(2, "0");
  return `${ADJECTIVES[adjIdx]}-${ANIMALS[aniIdx]}-${numStr}`;
}

/**
 * Recognise the slug shape so we can short-circuit cheaply when an
 * incoming arg is obviously a slug (skip the UUID-format check).
 *
 * Allows trailing alphanumeric in the third segment so future tweaks
 * (e.g. base32 numbers) stay backwards-compatible.
 */
export function looksLikeSlug(s: string): boolean {
  return /^[a-z]+-[a-z]+-[a-z0-9]+$/i.test(s);
}

/**
 * Resolve an input that may be a UUID or a slug to its UUID by looking
 * it up in a list of candidates. Used at command entry so users can
 * type either form.
 *
 * Returns:
 *   - the matching UUID if exactly one candidate matches
 *   - `null` if no candidate matches
 *   - `{ ambiguous: matches }` if more than one matches (collision —
 *     caller should print the matches and exit non-zero)
 */
export function resolveSlugOrId<T extends { id: string }>(
  input: string,
  candidates: readonly T[],
):
  | { ok: true; match: T }
  | { ok: false; reason: "not_found" }
  | {
      ok: false;
      reason: "ambiguous";
      matches: readonly T[];
    } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: "not_found" };

  // Fast path: exact id match. UUID input always falls here.
  const byId = candidates.find((c) => c.id === trimmed);
  if (byId) return { ok: true, match: byId };

  // Slug match — case-insensitive on the slug itself, but the slug
  // function is deterministic and lowercase, so just lowercase input.
  const wantSlug = trimmed.toLowerCase();
  const slugMatches = candidates.filter((c) => slugFromId(c.id) === wantSlug);
  if (slugMatches.length === 1) return { ok: true, match: slugMatches[0] };
  if (slugMatches.length > 1) {
    return { ok: false, reason: "ambiguous", matches: slugMatches };
  }
  return { ok: false, reason: "not_found" };
}
