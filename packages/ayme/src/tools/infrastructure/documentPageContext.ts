// The browser runtime's page context: the document's Page State Session and
// the Page Objects registered in it, for the Inspector and tests.
import { renderPomDefinitions } from "../../page-objects/domain";
import { getPomDefinitions } from "../../page-objects/infrastructure";
import type { Cursor } from "../../page-state/domain";
import { getPageStateSession } from "../../page-state/infrastructure";
import { pageContextFor, type PageContext } from "../application/pageContext";

/** The page context `cursor`'s reader receives; its cursor moves to the capture. */
export async function getPageContextForDocument(
  currentDocument: Document,
  cursor: Cursor,
  ...names: readonly string[]
): Promise<PageContext> {
  return pageContextFor(
    getPageStateSession(currentDocument),
    cursor,
    names,
    getPomDefinitions
  );
}

/**
 * The POM definitions for `names` (every known one when empty), as the text
 * `snapshot` returns in `pomDefinitions`. Captures no page state.
 */
export function getPomDefinitionText(...names: readonly string[]): string {
  return renderPomDefinitions(getPomDefinitions(...names).definitions);
}
