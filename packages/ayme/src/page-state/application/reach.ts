import type { Locator, Page } from "@playwright/test";

import type { ReachMeasurement } from "../../shared";

// Package-internal: what the layout shows of one element (ADR-0035,
// ADR-0041), measured in the page by the in-page module: it names what is
// in the way by Structural Ref and carries no `Element`.
export type { ReachMeasurement };

/**
 * Package-internal: how reach is measured, handed in rather than imported.
 * The runtime picks the adapter: Chromium's geometry in
 * `infrastructure/reachMeasurement.ts`, the in-page module's; unit tests hand in their own layout.
 * A Run carries it, and the Lite page driver reads the one the runtime
 * installed.
 */
export type Reach = {
  /**
   * Measures `element`, the one element `locator` resolves to, as a Page
   * Object Root: present only while the locator finds it visible.
   */
  measurePomRoot(locator: Locator, element: Element): Promise<ReachMeasurement>;
  /**
   * Measures `element` for offering it: the hit test is `page`'s own, at the
   * point a click of `page` would use. It takes the element as shown: a
   * caller that needs it visible checks that first.
   */
  measureReach(page: Page, element: Element): ReachMeasurement;
  /**
   * Measures `element`, the one element `locator` resolves to, for a call
   * that clicks it: the call's own scroll is run first, so the hit test is
   * where the click will land.
   */
  measureReachAtCall(
    locator: Locator,
    element: Element
  ): Promise<ReachMeasurement>;
  /**
   * What blocks both every click on `element`, whatever covers it, and its
   * focus: the last opened native modal when the element is not in one,
   * else its inert ancestor, by its Structural Ref.
   */
  blockingAncestor(element: Element): string | undefined;
  /**
   * Runs `measureAll`, a synchronous pass that measures a batch of elements
   * (every candidate of every tool) without changing the page; the adapter
   * may share work across the pass, and outside one measures afresh.
   */
  inReachBatch<T>(measureAll: () => T): T;
};
