import { useState } from "react";
import { SearchIcon } from "lucide-react";

import { cn } from "@ayme-dev/design-system/lib/utils";

import type { LegendCounts, Lens, LensId } from "./lens";
import type { Selection } from "./selection";

const MAX_RESULTS = 24;

/**
 * The navigator: one search over every lens, the lens switcher, the legend,
 * and the active lens's tree. Search results replace the tree while there
 * is a query.
 */
export function Navigator({
  lenses,
  activeLens,
  onLensChange,
  onSelect,
  onPreview,
  onPreviewRef,
  onPreviewEnd,
}: {
  lenses: readonly Lens[];
  activeLens: LensId;
  onLensChange: (lens: LensId) => void;
  onSelect: (selection: Selection) => void;
  /** Hovering a result that has a highlight path. */
  onPreview?: (path: string) => void;
  /** Hovering a result that has a highlight ref. */
  onPreviewRef?: (ref: string) => void;
  onPreviewEnd?: () => void;
}) {
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  const results = searching ? search(lenses, query) : [];
  const legend = mergeLegends(lenses);
  const active = lenses.find((lens) => lens.id === activeLens);

  const pick = ({ lens, entry }: (typeof results)[number]) => {
    setQuery("");
    onPreviewEnd?.();
    onLensChange(lens);
    onSelect(entry.selection);
  };

  return (
    <nav
      aria-label="Navigator"
      className="flex min-h-0 w-[290px] flex-none flex-col border-r @max-[719px]:w-[230px] in-data-[layout=bottom]:w-[270px]"
    >
      <div className="flex flex-col gap-2 border-b px-2.5 pt-2.5 pb-1.5">
        <label className="flex h-8 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-muted-foreground focus-within:border-transparent focus-within:outline-2 focus-within:outline-ring">
          <SearchIcon className="size-3.5 flex-none" aria-hidden />
          <input
            type="search"
            aria-label="Search page objects, actions, members and refs"
            placeholder="Search objects, actions, refs"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div
          role="group"
          aria-label="Lens"
          className="flex gap-0.5 rounded-[9px] bg-muted p-[3px]"
        >
          {lenses.map((lens) => (
            <button
              key={lens.id}
              type="button"
              aria-pressed={lens.id === activeLens}
              className="h-[26px] flex-1 rounded-[7px] text-[12.5px] font-medium text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-xs"
              onClick={() => onLensChange(lens.id)}
            >
              {lens.label}
            </button>
          ))}
        </div>
        <Legend counts={legend} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {searching ? (
          results.length ? (
            <ul aria-label="Search results" className="flex flex-col">
              {results.map((result) => (
                <li key={result.entry.key}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-px rounded-md px-2 py-1.5 text-left hover:bg-muted"
                    onClick={() => pick(result)}
                    onMouseEnter={() => {
                      const { highlightPath, highlightRef } = result.entry;
                      if (highlightPath) onPreview?.(highlightPath);
                      else if (highlightRef) onPreviewRef?.(highlightRef);
                    }}
                    onMouseLeave={() =>
                      (result.entry.highlightPath ||
                        result.entry.highlightRef) &&
                      onPreviewEnd?.()
                    }
                  >
                    <span className="flex max-w-full items-center gap-1.5">
                      <span className="w-[52px] flex-none text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                        {result.entry.kind}
                      </span>
                      <span
                        className="truncate font-mono text-xs"
                        title={result.entry.label}
                      >
                        {result.entry.label}
                      </span>
                    </span>
                    {result.entry.description && (
                      <span className="max-w-full truncate pl-[58px] text-[11.5px] text-muted-foreground">
                        {result.entry.description}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-3.5 text-center text-xs text-muted-foreground">
              Nothing matches.
            </p>
          )
        ) : (
          active?.tree
        )}
      </div>
    </nav>
  );
}

function Legend({ counts }: { counts: LegendCounts }) {
  const items = [
    counts.live !== undefined && (
      <span key="live" className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-success" aria-hidden />
        {counts.live} live
      </span>
    ),
    counts.notOnPage !== undefined && (
      <span key="off" className="inline-flex items-center gap-1.5">
        <span
          className="size-2 rounded-full shadow-[inset_0_0_0_1.5px_var(--color-muted-foreground)]"
          aria-hidden
        />
        {counts.notOnPage} not on page
      </span>
    ),
    counts.refs !== undefined && <span key="refs">{counts.refs} refs</span>,
  ].filter(Boolean);
  return (
    <div
      role="group"
      aria-label="Legend"
      className={cn(
        "flex gap-3 px-0.5 text-[11.5px] text-muted-foreground",
        !items.length && "hidden"
      )}
    >
      {items}
    </div>
  );
}

function mergeLegends(lenses: readonly Lens[]): LegendCounts {
  const merged: LegendCounts = {};
  for (const { legend } of lenses)
    for (const key of Object.keys(legend) as (keyof LegendCounts)[])
      merged[key] = (merged[key] ?? 0) + (legend[key] ?? 0);
  return merged;
}

function search(lenses: readonly Lens[], query: string) {
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
