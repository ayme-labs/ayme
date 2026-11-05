import type { Page } from "@playwright/test";

import type { ReachMeasurement } from "../../shared";

// Package-internal: what the layout shows of one element (ADR-0035,
// ADR-0041), measured in the page by the in-page module: it names what is
// in the way by Structural Ref and carries no `Element`.
export type { ReachMeasurement };

/**
 * Package-internal: what a tool sends its element, which must reach it
 * (ADR-0035): a click needs the element reached; keyboard input needs only
 * that it can take focus, which an open modal it is not in or an inert
 * ancestor prevents.
 */
export type ReachInput = "click" | "focus";

/**
 * Package-internal: how reach is measured, handed in rather than imported.
 * The runtime picks the adapter: the in-page module's, which measures the
 * layout in the document; unit tests hand in their own layout. A Run
 * carries it. Elements are named by Structural Ref, so the same port serves
 * a page in Node. A Page Object Root is probed in the page, where its reach
 * is measured with the root's presence.
 */
export type Reach = {
  /**
   * Of `refs`, those whose element `input` would reach on `page` now, in one
   * batch measured in the page, in the order given. The hit test is the
   * page's own, at the point a click of `page` would use. It takes the
   * elements as shown: a caller that needs them visible checks that first.
   */
  reachable(
    page: Page,
    refs: readonly string[],
    input: ReachInput
  ): Promise<string[]>;
  /**
   * Measures the element `ref` names for a call that clicks it: the call's
   * own scroll is run first, so the hit test is where the click will land.
   */
  measureReachAtCall(page: Page, ref: string): Promise<ReachMeasurement>;
  /**
   * What blocks both every click on the element `ref` names, whatever
   * covers it, and its focus: the last opened native modal when the element
   * is not in one, else its inert ancestor, by its Structural Ref.
   */
  blockingAncestor(page: Page, ref: string): Promise<string | undefined>;
};
