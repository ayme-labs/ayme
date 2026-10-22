import type { Locator } from "@playwright/test";
import { resolveLocatorElements } from "@ayme-dev/playwright-lite/internal";
import { inTheWayOf, measurePomRoot } from "../page-state";
import type { ObservedPomRoot } from "./pomInstance";

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
