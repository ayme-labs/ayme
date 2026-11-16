import { selectors } from "@ayme-dev/playwright-lite";
import { registerAymeRef } from "../../in-page";

/**
 * Package-internal: registers `ayme-ref` on Playwright Lite's selectors, the
 * selector engine that resolves a Structural Ref through the document's
 * in-page module (ADR-0038), so `page.locator("ayme-ref=e5")` acts on any
 * ref a capture prints, synthetic or not. Registered once per registry, and
 * a second copy of this module (a test's reload) finds it registered.
 */
export function registerRefSelectorEngine(): void {
  void registerAymeRef(selectors);
}
