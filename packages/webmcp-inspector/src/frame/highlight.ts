import type { Selection } from "./selection";

/**
 * Something to highlight on the page: a Page Object or member by its path
 * (e.g. "ListPage.items[1]" or "ListItem.nameButton"), or a structure node
 * by its ref.
 */
export type HighlightTarget = { path: string } | { ref: string };

/**
 * What a lens calls while the pointer is over something in the panel: the
 * page shows a dashed highlight on it, until the lens calls it again with
 * `undefined` when the pointer leaves. There is no pin to call: the solid
 * highlight always follows the selection (see {@link selectionHighlight}).
 */
export type OnHover = (target: HighlightTarget | undefined) => void;

/** The element(s) the solid highlight shows for a selection, if it has any. */
export function selectionHighlight(
  selection: Selection
): HighlightTarget | undefined {
  switch (selection.kind) {
    case "object":
    case "member":
      // A collection member's path reaches all its items; a locator's, its
      // element(s).
      return { path: selection.path };
    case "model":
      return { path: selection.className };
    case "node":
      return { ref: selection.ref };
    default:
      return undefined;
  }
}
