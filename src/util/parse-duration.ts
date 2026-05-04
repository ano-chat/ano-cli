/**
 * Parse a human-friendly duration string into milliseconds.
 *
 * Used by `--expires-in` on automation create/update to set
 * `expires_at = Date.now() + parseDuration(arg)`. Returns the parsed
 * millisecond delta, or throws a `RangeError` with a useful hint on
 * invalid input — the CLI surfaces that as a clean exit-2 error.
 *
 * Supported units (compact and word forms):
 *   m / minute / minutes  →  60 000 ms
 *   h / hour   / hours    →  3 600 000
 *   d / day    / days     →  86 400 000
 *   w / week   / weeks    →  604 800 000
 *   M / month  / months   →  30 days
 *   y / year   / years    →  365 days
 *
 * Compact `M` (uppercase) is month; compact `m` (lowercase) is minute.
 * Whole numbers only — fractional ("0.5d") rejected.
 * Negative / zero rejected (an expiry in the past would create-then-
 * immediately-disable the automation, which is never the user's intent).
 */

const UNIT_MS: Record<string, number> = {
  m: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
  M: 2_592_000_000, // 30 days
  month: 2_592_000_000,
  months: 2_592_000_000,
  y: 31_536_000_000, // 365 days
  year: 31_536_000_000,
  years: 31_536_000_000,
};

export function parseDuration(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new RangeError(
      "Empty duration. Try '5 weeks', '3 days', '12h', '30m'.",
    );
  }
  const match = trimmed.match(/^(\d+)\s*([A-Za-z]+)$/);
  if (!match) {
    throw new RangeError(
      `Couldn't parse "${input}". Expected forms: '5 weeks', '3 days', '12h', '30m'.`,
    );
  }
  const value = Number(match[1]);
  if (value <= 0) {
    throw new RangeError(`Duration must be positive. Got "${input}".`);
  }
  const unit = match[2];
  const lookup = unit === "M" ? "M" : unit.toLowerCase();
  const unitMs = UNIT_MS[lookup];
  if (unitMs === undefined) {
    throw new RangeError(
      `Unknown unit "${unit}" in "${input}". Try minutes, hours, days, weeks, months, years.`,
    );
  }
  return value * unitMs;
}
