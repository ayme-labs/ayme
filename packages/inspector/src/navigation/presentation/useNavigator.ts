import { useState } from "react";

import type { OnHover } from "../domain/highlight";
import type { Lens, LensId } from "../domain/lens";
import {
  entryHighlight,
  mergeLegends,
  searchLenses,
  type SearchResult,
} from "../domain/search";
import type { Selection } from "../domain/selection";

/**
 * The navigator's UI logic: the search over every lens, which replaces the
 * tree while there is a query, the legend, and picking a result.
 */
export function useNavigator({
  lenses,
  activeLens,
  onLensChange,
  onSelect,
  onHover,
}: {
  lenses: readonly Lens[];
  activeLens: LensId;
  onLensChange: (lens: LensId) => void;
  onSelect: (selection: Selection) => void;
  onHover?: OnHover;
}) {
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  return {
    query,
    setQuery,
    searching,
    results: searching ? searchLenses(lenses, query) : [],
    legend: mergeLegends(lenses),
    active: lenses.find((lens) => lens.id === activeLens),
    pick: ({ lens, entry }: SearchResult) => {
      setQuery("");
      onHover?.(undefined);
      onLensChange(lens);
      onSelect(entry.selection);
    },
    highlightOf: ({ entry }: SearchResult) => entryHighlight(entry),
  };
}
