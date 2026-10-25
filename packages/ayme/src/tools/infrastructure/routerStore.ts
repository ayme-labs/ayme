// The router function of the current runtime session, and the Browser Tools
// that move the page, built on it.
import { navigationTools } from "../application/browserTools";
import type { RouterNavigate } from "../application/navigateTool";

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
 * Package-internal: the Browser Tools that move the page, in publication
 * order; `navigate` reads the stored router function when a call runs.
 * Computed once, so each resolves to the same object across publications.
 */
export const NAVIGATION_TOOLS = navigationTools(() => routerStore.navigate);
