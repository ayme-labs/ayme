/**
 * Test-only hook, not public API. The Inspector renders into a closed shadow
 * root, so no locator engine on the host page, and no page-state capture,
 * sees inside it. Tests reach it through this key: the mount stores the root
 * on its host element under `Symbol.for(INSPECTOR_SHADOW_ROOT_KEY)`, and the
 * testing entry's Playwright selector engine reads it back.
 *
 * The key is page-global on purpose: Playwright injects the selector engine
 * into the page as a string, so it can't import anything from this bundle and
 * can only read what the host element carries. "Closed" therefore means
 * hidden from locator engines and the page state, which never read this key,
 * not hidden from the page's own scripts.
 */
export const INSPECTOR_SHADOW_ROOT_KEY =
  "@ayme-dev/webmcp-inspector/shadow-root";

type HookedHost = Element & { [key: symbol]: ShadowRoot | undefined };

export function exposeInspectorShadowRoot(host: Element, root: ShadowRoot) {
  (host as HookedHost)[Symbol.for(INSPECTOR_SHADOW_ROOT_KEY)] = root;
}

/** The Inspector's closed shadow root on its host element, for tests. */
export function inspectorShadowRoot(host: Element): ShadowRoot | undefined {
  return (host as HookedHost)[Symbol.for(INSPECTOR_SHADOW_ROOT_KEY)];
}
