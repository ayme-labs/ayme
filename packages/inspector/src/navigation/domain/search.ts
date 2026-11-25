import type { LegendCounts, Lens, LensId, SearchEntry } from "./lens";

const MAX_RESULTS = 24;

export type SearchResult = { lens: LensId; entry: SearchEntry };

export function entryHighlight(entry: SearchEntry) {
  return (
    entry.highlight ??
    (entry.highlightPath ? { path: entry.highlightPath } : undefined)
  );
}

export function mergeLegends(lenses: readonly Lens[]): LegendCounts {
  const merged: LegendCounts = {};
  for (const { legend } of lenses)
    for (const key of Object.keys(legend) as (keyof LegendCounts)[])
      merged[key] = (merged[key] ?? 0) + (legend[key] ?? 0);
  return merged;
}

/** The entries of every lens whose label or description holds the query. */
export function searchLenses(
  lenses: readonly Lens[],
  query: string
): SearchResult[] {
  const needle = query.trim().toLowerCase();
  return lenses
    .flatMap((lens) =>
      lens.searchEntries.map((entry) => ({ lens: lens.id, entry }))
    )
    .filter(({ entry }) =>
      `${entry.label} ${entry.description ?? ""}`.toLowerCase().includes(needle)
    )
    .slice(0, MAX_RESULTS);
}
