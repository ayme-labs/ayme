// The router function of the current runtime session, and the Browser Tools
// that move the page, built on it.
import type { PublishedElementTool } from "../application/elementTools";
import {
  navigateBackTool,
  navigateForwardTool,
  reloadTool,
} from "../application/historyTools";
import { navigateTool, type RouterNavigate } from "../application/navigateTool";

type RouterStore = { navigate?: RouterNavigate };

// On globalThis, so every bundle that loads Ayme in one process shares one
// router function.
const routerStore: RouterStore = ((
  globalThis as typeof globalThis & { __aymeRouterStore?: RouterStore }
).__aymeRouterStore ??= {});

/**
 * Package-internal: store or clear the router function for the current
 * runtime session. Called by `start()` and `stop()` in `runtime.ts`.
 */
export function configureRouterNavigate(
  navigate: RouterNavigate | undefined
): void {
  routerStore.navigate = navigate;
}

/**
 * Package-internal: the Browser Tools that move the page to another URL or
 * history entry, in publication order. They take no element; each is
 * published and the Goal Loop may choose it. `navigate` hands its URL to the
 * stored router function, if any, when a call runs. Computed once, so each
 * resolves to the same object across publications.
 */
export const NAVIGATION_TOOLS: readonly PublishedElementTool[] = [
  navigateTool(() => routerStore.navigate),
  navigateBackTool,
  navigateForwardTool,
  reloadTool,
];
