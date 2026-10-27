import type { Locator } from "@playwright/test";
import { resolveLocatorElements } from "@ayme-dev/playwright-lite/internal";
import { inTheWayOf } from "../../page-state/infrastructure";
import { type Reach } from "../../page-state/application";
import { absentPomRoot, type ObservedPomRoot } from "../domain/pomInstance";

/**
 * Package-internal: observes one Page Object Root without scrolling or
 * sending input, as `reach` measures it, with how many elements its locator
 * matched. The root is present only while the locator resolved to one
 * visible element throughout.
 */
export async function observePomRoot(
  locator: Locator,
  reach: Reach
): Promise<{ count: number; root: ObservedPomRoot }> {
  const count = await locator.count();
  const elements = resolveLocatorElements(locator);
  const element =
    count === 1 && elements.length === 1 ? elements[0] : undefined;
  const root = element && (await observeElement(reach, locator, element));
  const current = resolveLocatorElements(locator);
  return {
    count,
    root:
      root && current.length === 1 && current[0] === element
        ? root
        : absentPomRoot,
  };
}

async function observeElement(
  reach: Reach,
  locator: Locator,
  element: Element
): Promise<ObservedPomRoot> {
  const measurement = await reach.measurePomRoot(locator, element);
  if (!measurement.present) return { ...absentPomRoot, element };
  return {
    element,
    present: true,
    available: measurement.available,
    inTheWay: inTheWayOf(measurement, element),
  };
}
