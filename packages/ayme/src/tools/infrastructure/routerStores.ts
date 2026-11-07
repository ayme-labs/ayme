// The router function of a runtime session, kept per Page (ADR-0049): the
// browser runtime's is that of its own Playwright Lite page, a Node host's
// that of the Page it was handed.
import type { Page } from "@playwright/test";
import type { RouterNavigate } from "../application/navigateTool";

const navigates = new WeakMap<Page, RouterNavigate>();

/**
 * Package-internal: store or clear the router function of the runtime
 * session on `page`.
 */
export function configureRouterNavigateOf(
  page: Page,
  navigate: RouterNavigate | undefined
): void {
  if (navigate) navigates.set(page, navigate);
  else navigates.delete(page);
}

/** Package-internal: the router function of the session on `page`, if any. */
export function routerNavigateOf(page: Page): RouterNavigate | undefined {
  return navigates.get(page);
}
