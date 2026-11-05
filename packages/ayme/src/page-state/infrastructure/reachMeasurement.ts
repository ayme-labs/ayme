import type { Locator, Page } from "@playwright/test";
import { reachInRealm } from "../../in-page";
import type { Reach, ReachMeasurement } from "../application/reach";

const absent: ReachMeasurement = { present: false, available: false };
const reached: ReachMeasurement = { present: true, available: true };

/**
 * Package-internal: the Reach adapter of the browser runtime. It measures
 * in the document, in the in-page module (ADR-0049), the same measurement a
 * Node host reads through `inPage(page).measureReach` (ADR-0041). The
 * runtime picks it unless a unit test hands its session another.
 */
export const geometryReach: Reach = {
  async measurePomRoot(locator: Locator, element: Element) {
    try {
      if (!(await locator.isVisible())) return absent;
    } catch {
      return absent;
    }
    return reachInRealm().measure(element);
  },
  measureReach: (_page: Page, element: Element) =>
    reachInRealm().measure(element),
  async measureReachAtCall(locator: Locator, element: Element) {
    const reach = reachInRealm();
    const before = reach.measureBeforeScroll(element);
    if (before !== "scroll") return before;
    // A scroll that fails leaves the measurement to the action, whose own
    // error says why.
    try {
      await locator.scrollIntoViewIfNeeded();
    } catch {
      return reached;
    }
    return reach.measureAfterScroll(element);
  },
  blockingAncestor: (element: Element) =>
    reachInRealm().blockingAncestor(element),
  inReachBatch: (measureAll) => reachInRealm().inBatch(measureAll),
};
