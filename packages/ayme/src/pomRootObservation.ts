import type { Locator } from "@playwright/test";
import { resolveLocatorElements } from "@ayme-dev/playwright-lite/internal";
import { inTheWayOf } from "./elementReach";
import { measurePomRoot } from "./reachMeasurement";

/**
 * Package-internal: what one observation of a Page Object Root found
 * (ADR-0035): whether it is on the page, whether a click would reach it,
 * and, for a present root a click would not reach, what is in the way. The
 * runtime reports the measurement, never a kind of widget.
 */
export type ObservedPomRoot = {
  /** Its element, while the locator resolved to that one element throughout. */
  element: Element | undefined;
  present: boolean;
  available: boolean;
  /**
   * What an Availability Reason may name as in the way of a present root a
   * click would not reach (see `inTheWayOf`); empty for every other root.
   */
  inTheWay: readonly Element[];
};

const absent: ObservedPomRoot = {
  element: undefined,
  present: false,
  available: false,
  inTheWay: [],
};

/**
 * Package-internal: observes one Page Object Root without scrolling or
 * sending input, with how many elements its locator matched. The root is
 * present only while the locator resolved to one visible element throughout.
 */
export async function observePomRoot(
  locator: Locator
): Promise<{ count: number; root: ObservedPomRoot }> {
  const count = await locator.count();
  const elements = resolveLocatorElements(locator);
  const element =
    count === 1 && elements.length === 1 ? elements[0] : undefined;
  const root = element && (await observeElement(locator, element));
  const current = resolveLocatorElements(locator);
  return {
    count,
    root:
      root && current.length === 1 && current[0] === element ? root : absent,
  };
}

async function observeElement(
  locator: Locator,
  element: Element
): Promise<ObservedPomRoot> {
  const measurement = await measurePomRoot(locator, element);
  if (!measurement.present) return { ...absent, element };
  return {
    element,
    present: true,
    available: measurement.available,
    inTheWay: inTheWayOf(measurement, element),
  };
}
