// The browser runtime's router function, kept per Page (ADR-0049).
import { pageOfDocument } from "../../page-state/infrastructure";
import type { RouterNavigate } from "../application/navigateTool";
import { configureRouterNavigateOf, routerNavigateOf } from "./routerStores";

/**
 * Package-internal: store or clear the router function for the current
 * runtime session in the browser. Called by `start()` and `stop()` in
 * `runtime.ts`.
 */
export function configureRouterNavigate(
  navigate: RouterNavigate | undefined
): void {
  configureRouterNavigateOf(pageOfDocument(document), navigate);
}

/** Package-internal: the browser session's router function, if any. */
export function routerNavigate(): RouterNavigate | undefined {
  return routerNavigateOf(pageOfDocument(document));
}
