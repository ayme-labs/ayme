import { containsThroughShadow, parentElement } from "./composedTree";
import { obstructionReason, type LatestRefLookup } from "./pomInstance";
import {
  blockingAncestor,
  measureReach,
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
 * Package-internal: the Availability Reason for sending `input` to `element`,
 * one element of the page a Browser Tool addresses, or undefined while the
 * input would reach it. The same measurement and wording as a Page Object
 * Root's (ADR-0035): it never names a kind of widget.
 */
export function unreachableReason(
  element: Element,
  latestRefOf: LatestRefLookup,
  input: ElementInput
): string | undefined {
  if (input === "focus") {
    const blocker = blockingAncestor(element);
    if (!blocker) return undefined;
    const ref = latestRefOf(blocker);
    return ref === undefined
      ? "it cannot take focus"
      : `it cannot take focus; ${ref} is in the way`;
  }
  const measurement = measureReach(element);
  if (measurement.available) return undefined;
  return obstructionReason(inTheWayOf(measurement, element), latestRefOf);
}

/**
 * Package-internal: whether `input` would reach `element`, as the Goal Loop
 * and the Inspector offer refs for the tools that need one.
 */
export function reaches(element: Element, input: ElementInput): boolean {
  return input === "focus"
    ? !blockingAncestor(element)
    : measureReach(element).available;
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
