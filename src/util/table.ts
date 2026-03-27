/** Render an array of objects as a GFM-compatible markdown table. */
export function renderTable(
  rows: Record<string, unknown>[],
  columns: string[],
): string {
  if (rows.length === 0) return "(empty)";

  const widths = columns.map((col) =>
    Math.max(
      col.length,
      ...rows.map((r) => String(r[col] ?? "").length),
    ),
  );

  const header = columns
    .map((col, i) => col.padEnd(widths[i]))
    .join(" | ");
  const separator = widths.map((w) => "-".repeat(w)).join(" | ");
  const body = rows
    .map((row) =>
      columns
        .map((col, i) => String(row[col] ?? "").padEnd(widths[i]))
        .join(" | "),
    )
    .join("\n");

  return `${header}\n${separator}\n${body}`;
}
