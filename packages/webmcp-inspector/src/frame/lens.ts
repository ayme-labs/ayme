import type { ReactNode } from "react";

import type { Selection } from "./selection";

export type LensId = "model" | "structure" | "tools";

/** One thing search can find. Picking it selects it and shows its lens. */
export type SearchEntry = {
  /** Unique across all lenses. */
  key: string;
  /** What it is, e.g. "Object", "POM", "Action", "Member" or "Ref". */
  kind: string;
  label: string;
  description?: string;
  selection: Selection;
  /** The registry path to highlight on the page while it's hovered. */
  highlightPath?: string;
  /** The structure node to highlight on the page while it's hovered. */
  highlightRef?: string;
};

/** The navigator's legend. Each lens counts what it knows. */
export type LegendCounts = {
  /** Page Objects on the page. */
  live?: number;
  /** Page Object Models not on the page. */
  notOnPage?: number;
  refs?: number;
};

/**
 * What a lens contributes to the frame: its tree in the navigator, what
 * search finds through it, its legend counts, and the detail view for each
 * selection it owns.
 */
export type Lens = {
  id: LensId;
  label: string;
  tree: ReactNode;
  searchEntries: readonly SearchEntry[];
  legend: LegendCounts;
  /** The detail view of a selection this lens owns; undefined otherwise. */
  detail: (selection: Selection) => ReactNode | undefined;
};
