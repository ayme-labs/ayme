import type { StructureTree } from "../adapter/structure";
import { memberResolves } from "./memberSelection";
import type { Selection } from "../navigation/domain/selection";

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
    within,
  }: {
    /** Whether some lens shows a view of the selection. */
    hasView: boolean;
    structure: StructureTree;
    pageStateRead: boolean;
    /** The paths of what a member path names and of everything inside it. */
    within: (path: string) => ReadonlySet<string>;
  }
) {
  if (selection.kind === "page") return false;
  if (selection.kind === "member")
    return pageStateRead && !memberResolves(structure, within(selection.path));
  return !hasView;
}
