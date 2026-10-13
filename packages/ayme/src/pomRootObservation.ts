import type { Locator } from "@playwright/test";
import { resolveLocatorElements } from "@ayme-dev/playwright-lite/internal";
import { containsThroughShadow, parentElement } from "./composedTree";
import { measurePomRoot } from "./pomRootMeasurement";

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
   * click would not reach, nearest first; it names the first the agent's
   * latest page state gave a ref. The open native modal the root is not in,
   * or the root's inert ancestor, stands alone, as does an element
   * hit-testing found that is a modal or holds the root; else the element
   * hit-testing found and its ancestors up to the first that holds the root,
   * since what holds the root is not in its way. Empty when nothing was found, as for
   * every other root.
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
  const { present, available, blocker, hit } = await measurePomRoot(
    locator,
    element
  );
  if (!present) return { ...absent, element };
  return {
    element,
    present,
    available,
    inTheWay: blocker ? [blocker] : hit ? walkedUp(hit, element) : [],
  };
}

/**
 * `hit` and its ancestors up to the first that holds `root`, or `hit` alone
 * when it holds `root` itself, as `root`'s own ancestor does when nothing
 * else takes the click, or is an open native modal.
 */
function walkedUp(hit: Element, root: Element): Element[] {
  if (containsThroughShadow(hit, root) || isModal(hit)) return [hit];
  const elements: Element[] = [];
  for (
    let node: Element | null = hit;
    node && !containsThroughShadow(node, root);
    node = parentElement(node)
  )
    elements.push(node);
  return elements;
}

function isModal(element: Element): boolean {
  try {
    return element.matches(":modal");
  } catch {
    return false;
  }
}
