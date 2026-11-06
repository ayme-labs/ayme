// The Custom Tools of a runtime session, and the element tools they join,
// kept per Page (ADR-0049): the browser runtime's are those of its own
// Playwright Lite page, a Node host's those of the Page it was handed.
import { pageOfDocument } from "../../page-state/infrastructure";
import {
  configureCustomToolsOf,
  listCustomToolsOf,
  listElementToolsOf,
} from "./customToolStores";
import type { NamedFilter } from "../../shared";
import {
  registerCustomTool,
  type CustomTool,
  type RegisteredElementTool,
} from "../application/elementTools";

/** Package-internal: set while a runtime session is active in the browser. */
export function configureCustomTools(
  customTools: readonly CustomTool[] | undefined,
  filters: readonly NamedFilter[] | undefined
): void {
  configureCustomToolsOf(
    pageOfDocument(document),
    customTools?.map(registerCustomTool),
    filters
  );
}

/** Package-internal: the Custom Tools of the active session, in registration order. */
export function listCustomTools(): readonly RegisteredElementTool[] {
  return listCustomToolsOf(pageOfDocument(document));
}

/** Package-internal: the browser session's element tools, in publication order. */
export function listElementTools(): readonly RegisteredElementTool[] {
  return listElementToolsOf(pageOfDocument(document));
}
