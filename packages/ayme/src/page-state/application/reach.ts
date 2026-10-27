import type { Locator, Page } from "@playwright/test";

/**
 * Package-internal: what the layout shows of one element (ADR-0035,
 * ADR-0041), measured without scrolling or sending input: `present` while
 * some part of it shows, or would once its scroll containers and the
 * viewport scrolled to it; `available` while a click would reach it; and,
 * for a present element a click would not reach, what stopped it:
 * `blocker`, the open native modal the element is not in or the element's
 * inert ancestor, which blocks every click; else `hit`, the element
 * playwright-lite's own hit test found at the point it would click, when
 * that point is in a part of the element shown now. Otherwise the element is
 * not hit-tested: the call scrolls it into view first and tests it there,
 * as it does every element, since that scroll also moves one partly shown;
 * unless a modal layer opened over the rest of the page hid it, whose hidden
 * ancestor is then the `blocker`, and nothing is scrolled.
 * Presence
 * describes the current layout, not content a scroll handler might create.
 * It names no kind of widget: a Page Object Root and an element a Browser
 * Tool addresses are measured alike.
 */
export type ReachMeasurement = {
  present: boolean;
  available: boolean;
  blocker?: Element;
  hit?: Element;
};

/**
 * Package-internal: how reach is measured, handed in rather than imported.
 * The runtime picks the adapter: Chromium's geometry in
 * `infrastructure/reachMeasurement.ts`; unit tests hand in their own layout.
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
   * else its inert ancestor.
   */
  blockingAncestor(element: Element): Element | undefined;
  /**
   * Runs `measureAll`, a synchronous pass that measures a batch of elements
   * (every candidate of every tool) without changing the page; the adapter
   * may share work across the pass, and outside one measures afresh.
   */
  inReachBatch<T>(measureAll: () => T): T;
};
