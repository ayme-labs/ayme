import { SearchIcon } from "lucide-react";

import { cn } from "@ayme-dev/design-system/lib/utils";

import {
  focusRing,
  INSPECTOR_PAGE_RENDERING_ATTRIBUTE,
  pressable,
  QualifiedName,
  rowFocusRing,
  rowPress,
} from "../../shared";

import type { HighlightTarget, OnHover } from "../domain/highlight";
import type { LegendCounts, Lens, LensId } from "../domain/lens";
import type { SearchResult } from "../domain/search";

/**
 * The navigator: one search over every lens, the lens switcher, the legend,
 * and the active lens's tree. Search results replace the tree while there
 * is a query.
 */
export function NavigatorView({
  lenses,
  activeLens,
  onLensChange,
  onHover,
  query,
  setQuery,
  searching,
  results,
  legend,
  active,
  pick,
  highlightOf,
}: {
  lenses: readonly Lens[];
  activeLens: LensId;
  onLensChange: (lens: LensId) => void;
  /** Hovering a search result. */
  onHover?: OnHover;
  query: string;
  setQuery: (query: string) => void;
  /** Whether results replace the tree. */
  searching: boolean;
  results: readonly SearchResult[];
  legend: LegendCounts;
  /** The active lens, whose tree shows. */
  active: Lens | undefined;
  pick: (result: SearchResult) => void;
  /** What the page highlights while a result is hovered. */
  highlightOf: (result: SearchResult) => HighlightTarget | undefined;
}) {
  return (
    <nav
      aria-label="Navigator"
      className="flex min-h-0 w-navigator flex-none flex-col border-r @max-panel-narrow:w-navigator-narrow in-data-[layout=bottom]:w-navigator-docked"
    >
      <div className="flex flex-col gap-2 border-b px-2.5 pt-2.5 pb-1.5">
        <label className="flex h-8 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-muted-foreground focus-within:border-transparent focus-within:outline-2 focus-within:outline-ring">
          <SearchIcon className="size-3.5 flex-none" aria-hidden />
          <input
            type="search"
            aria-label="Search page objects, actions, members and refs"
            placeholder="Search objects, actions, refs"
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div
          role="group"
          aria-label="Lens"
          className="flex gap-0.5 rounded-lg bg-muted p-0.75"
        >
          {lenses.map((lens) => (
            <button
              key={lens.id}
              type="button"
              aria-pressed={lens.id === activeLens}
              className={cn(
                // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
                "h-6.5 flex-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-xs dark:aria-pressed:bg-neutral-700",
                focusRing,
                pressable
              )}
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
            <ul
              aria-label="Search results"
              {...{ [INSPECTOR_PAGE_RENDERING_ATTRIBUTE]: "" }}
              className="flex flex-col"
            >
              {results.map((result) => (
                <li key={result.entry.key}>
                  <button
                    type="button"
                    className={cn(
                      // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
                      "flex w-full flex-col items-start gap-px rounded-md px-2 py-1.5 text-left hover:bg-muted",
                      rowFocusRing,
                      rowPress
                    )}
                    onClick={() => pick(result)}
                    onMouseEnter={() => onHover?.(highlightOf(result))}
                    onMouseLeave={() => onHover?.(undefined)}
                  >
                    <span className="flex max-w-full items-center gap-1.5">
                      <span className="w-13 flex-none text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                        {result.entry.kind}
                      </span>
                      <QualifiedName
                        name={result.entry.label}
                        className="font-mono text-xs"
                      />
                    </span>
                    {result.entry.description && (
                      <span className="max-w-full truncate pl-14.5 text-xs text-muted-foreground">
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
      <span
        key="live"
        className="inline-flex items-center gap-1.5 whitespace-nowrap"
      >
        <span className="size-2 rounded-full bg-success" aria-hidden />
        <span className="tabular-nums">{counts.live}</span> live
      </span>
    ),
    counts.notOnPage !== undefined && (
      <span
        key="off"
        className="inline-flex items-center gap-1.5 whitespace-nowrap"
      >
        <span
          className="size-2 rounded-full shadow-[inset_0_0_0_1.5px_var(--color-muted-foreground)]"
          aria-hidden
        />
        <span className="tabular-nums">{counts.notOnPage}</span> not on page
      </span>
    ),
    counts.refs !== undefined && (
      <span key="refs" className="whitespace-nowrap">
        <span className="tabular-nums">{counts.refs}</span> refs
      </span>
    ),
  ].filter(Boolean);
  return (
    <div
      role="group"
      aria-label="Legend"
      className={cn(
        // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
        "flex flex-wrap gap-x-3 gap-y-0.5 px-0.5 text-xs text-muted-foreground",
        !items.length && "hidden"
      )}
    >
      {items}
    </div>
  );
}
