// The Custom Tools of a runtime session, and the element tools they join,
// kept per Page (ADR-0049): the browser runtime's are those of its own
// Playwright Lite page, a Node host's those of the Page it was handed.
import type { Page } from "@playwright/test";
import { configurePageStateFiltersOf } from "../../page-state/infrastructure";
import type { NamedFilter } from "../../shared";
import { SINGLE_ELEMENT_TOOLS } from "../application/browserTools";
import type { RegisteredElementTool } from "../application/elementTools";

const registeredByPage = new WeakMap<Page, readonly RegisteredElementTool[]>();

/**
 * Package-internal: set while a runtime session is active on `page`, with the
 * tools registered and their filters checked.
 */
export function configureCustomToolsOf(
  page: Page,
  registered: readonly RegisteredElementTool[] | undefined,
  filters: readonly NamedFilter[] | undefined
): void {
  if (registered) registeredByPage.set(page, registered);
  else registeredByPage.delete(page);
  configurePageStateFiltersOf(page, filters);
}

/** Package-internal: the Custom Tools of the session on `page`, in registration order. */
export function listCustomToolsOf(
  page: Page
): readonly RegisteredElementTool[] {
  return registeredByPage.get(page) ?? [];
}

/**
 * Package-internal: the single-element Browser Tools and the session's Custom
 * Tools on `page`, in publication order. Each is published and the Goal Loop
 * may choose it (ADR-0023).
 */
export function listElementToolsOf(
  page: Page
): readonly RegisteredElementTool[] {
  return [...SINGLE_ELEMENT_TOOLS, ...listCustomToolsOf(page)];
}
