// The Custom Tools of a runtime session, and the element tools they join,
// kept per Page (ADR-0049): the browser runtime's are those of its own
// Playwright Lite page, a Node host's those of the Page it was handed.
import { pageOfDocument } from "../../page-state/infrastructure";
import {
  configureCustomToolsOf,
  listCustomToolsOf,
  listElementToolsOf,
} from "./customToolStores";
import { registerFilter } from "../../in-page";
import type { NamedFilter } from "../../shared";
import {
  registerCustomTool,
  type CustomTool,
  type RegisteredElementTool,
} from "../application/elementTools";

/**
 * Package-internal: each Custom Tool's filter, checked as the page runs it,
 * under the tool's name. A function that reads the code around it is refused
 * here, before a session starts.
 */
export function checkCustomToolFilters(
  customTools: readonly CustomTool[] | undefined
): NamedFilter[] {
  const filters: NamedFilter[] = [];
  for (const tool of customTools ?? [])
    if (tool.filter !== undefined)
      filters.push({
        name: tool.name,
        filter: registerFilter(
          `\`filter\` of the Custom Tool \`${tool.name}\``,
          tool.filter
        ),
      });
  return filters;
}

/** Package-internal: set while a runtime session is active in the browser. */
export function configureCustomTools(
  customTools: readonly CustomTool[] | undefined,
  filters: readonly NamedFilter[] = checkCustomToolFilters(customTools)
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
