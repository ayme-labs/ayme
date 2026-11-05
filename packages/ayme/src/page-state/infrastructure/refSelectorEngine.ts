import { selectors } from "@ayme-dev/playwright-lite";
import { registerAymeRef } from "../../in-page";

// On the global object, not in this module: the selectors registry outlives
// a reload of this module (as a test's `vi.resetModules` does), and refuses a
// second registration of the name.
const REGISTERED = Symbol.for("ayme.refSelectorEngine.registered");
const registry = globalThis as { [REGISTERED]?: true };

/**
 * Package-internal: registers `ayme-ref` on Playwright Lite's selectors, the
 * selector engine that resolves a Structural Ref through the document's
 * in-page module (ADR-0038), so `page.locator("ayme-ref=e5")` acts on any
 * ref a capture prints, synthetic or not. Registered once.
 */
export function registerRefSelectorEngine(): void {
  if (registry[REGISTERED]) return;
  registry[REGISTERED] = true;
  // Registration completes synchronously; the promise only reports a name
  // this guard already excludes.
  void registerAymeRef(selectors);
}
