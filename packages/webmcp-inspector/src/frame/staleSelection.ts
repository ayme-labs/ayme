import type { StructureTree } from "../adapter/structure";
import { memberResolves } from "./memberSelection";
import type { Selection } from "./selection";

/**
 * Whether a selection is stale, so the frame sends it back to the page.
 * - The page is never stale.
 * - A member is stale when its path no longer resolves on the page, judged
 *   only once the page state has been read. It needn't have a view.
 * - Anything else is stale when no lens can show it any more, e.g. a tool
 *   that is no longer live.
 */
export function isStaleSelection(
  selection: Selection,
  {
    hasView,
    structure,
    pageStateRead,
  }: {
    /** Whether some lens shows a view of the selection. */
    hasView: boolean;
    structure: StructureTree;
    pageStateRead: boolean;
  }
) {
  if (selection.kind === "page") return false;
  if (selection.kind === "member")
    return pageStateRead && !memberResolves(structure, selection.path);
  return !hasView;
}
