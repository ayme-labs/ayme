import type { Locator, Page } from "@playwright/test";
import { resolveLocatorElements } from "@ayme-dev/playwright-lite/internal";
import { containsThroughShadow, parentElement } from "./composedTree";
import { latestPageStateRef } from "./pageState";
import {
  assertAvailable,
  obstructionReason,
  type LatestRefLookup,
} from "./pomInstance";
import {
  blockingAncestor,
  measureReach,
  measureReachAtCall,
  type ReachMeasurement,
} from "./reachMeasurement";

/**
 * Package-internal: the input a tool sends its element. A click needs to
 * reach it (ADR-0035); keyboard input needs only that it can take focus,
 * which an open modal it is not in or an inert ancestor prevents.
 */
export type ElementInput = "click" | "focus";

/**
 * Package-internal: what an Availability Reason may name as in the way of
 * `element`, a present element a click would not reach, nearest first; it
 * names the first the agent's latest page state gave a ref. The open native
 * modal the element is not in, or its inert ancestor, stands alone, as does
 * an element hit-testing found that is a modal or holds `element`; else the
 * element hit-testing found and its ancestors up to the first that holds
 * `element`, since what holds it is not in its way. Empty when nothing was
 * found.
 */
export function inTheWayOf(
  { blocker, hit }: ReachMeasurement,
  element: Element
): Element[] {
  return blocker ? [blocker] : hit ? walkedUp(hit, element) : [];
}

/**
 * Package-internal: whether `input` would reach `element` now, as the Goal
 * Loop and the Inspector offer refs for the tools that need one; the hit
 * test is `page`'s own (ADR-0041).
 */
export function reaches(
  page: Page,
  element: Element,
  input: ElementInput
): boolean {
  return input === "focus"
    ? !blockingAncestor(element)
    : measureReach(page, element).available;
}

/**
 * Package-internal: refuses the call of `toolName` that sends `input` to
 * `element`, the one element `locator` resolves to, when the input would not
 * reach it, with the Availability Reason a Page Object Tool gives: the same
 * measurement and wording as a Page Object Root's (ADR-0035), which never
 * names a kind of widget. A click's reach is measured where the click would
 * land: an element that shows no part now is scrolled into view first, as
 * the call's own action would scroll it.
 */
export async function assertReachable(
  toolName: string,
  locator: Locator,
  element: Element,
  input: ElementInput
): Promise<void> {
  const reason = await unreachableReason(
    locator,
    element,
    latestPageStateRef,
    input
  );
  if (reason !== undefined)
    assertAvailable(toolName, { present: true, available: false, reason });
}

/**
 * Package-internal: refuses the call of the Page Object Tool `toolName` when
 * a click would not reach `root`, its Page Object Root, as `assertReachable`
 * does for an element. A root that is not one element now is left to the
 * observation that listed the tool and to the action itself.
 */
export async function assertRootReachable(
  toolName: string,
  root: Locator
): Promise<void> {
  const elements = resolveLocatorElements(root);
  if (elements.length === 1)
    await assertReachable(toolName, root, elements[0]!, "click");
}

async function unreachableReason(
  locator: Locator,
  element: Element,
  latestRefOf: LatestRefLookup,
  input: ElementInput
): Promise<string | undefined> {
  if (input === "focus") {
    const blocker = blockingAncestor(element);
    if (!blocker) return undefined;
    const ref = latestRefOf(blocker);
    return ref === undefined
      ? "it cannot take focus"
      : `it cannot take focus; ${ref} is in the way`;
  }
  const measurement = await measureReachAtCall(locator, element);
  if (measurement.available) return undefined;
  return obstructionReason(inTheWayOf(measurement, element), latestRefOf);
}

/**
 * `hit` and its ancestors up to the first that holds `element`, or `hit`
 * alone when it holds `element` itself, as `element`'s own ancestor does when
 * nothing else takes the click, or is an open native modal.
 */
function walkedUp(hit: Element, element: Element): Element[] {
  if (containsThroughShadow(hit, element) || isModal(hit)) return [hit];
  const elements: Element[] = [];
  for (
    let node: Element | null = hit;
    node && !containsThroughShadow(node, element);
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
