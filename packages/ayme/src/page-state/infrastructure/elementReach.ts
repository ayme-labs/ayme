import type { Locator, Page } from "@playwright/test";
import { elementOfRef } from "../../in-page";
import { latestPageStateRef } from "./pageState";
import {
  assertAvailable,
  obstructionReason,
  unfocusableReason,
  type LatestRefLookup,
} from "../domain/toolAvailability";
import type { Reach, ReachMeasurement } from "../application/reach";

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
export function inTheWayOf({ blocker, hit }: ReachMeasurement): Element[] {
  return elementsOf(blocker ? [blocker] : (hit ?? []));
}

/** The elements the in-page module named by ref, as far as they are still there. */
function elementsOf(refs: readonly string[]): Element[] {
  return refs.flatMap((ref) => elementOfRef(ref) ?? []);
}

/**
 * Package-internal: whether `input` would reach `element` now, as `reach`
 * measures it, as the Goal Loop and the Inspector offer refs for the tools
 * that need one; the hit test is `page`'s own (ADR-0041).
 */
export function reaches(
  reach: Reach,
  page: Page,
  element: Element,
  input: ElementInput
): boolean {
  return input === "focus"
    ? !reach.blockingAncestor(element)
    : reach.measureReach(page, element).available;
}

/**
 * Package-internal: refuses the call of `toolName` that sends `input` to
 * `element`, the one element `locator` resolves to, when the input would not
 * reach it as `reach` measures it, with the Availability Reason a Page
 * Object Tool gives: the same
 * measurement and wording as a Page Object Root's (ADR-0035), which never
 * names a kind of widget. A click's reach is measured where the click would
 * land: the element is scrolled into view first, as the call's own action
 * scrolls it, which also moves an element only partly shown.
 */
export async function assertReachable(
  reach: Reach,
  toolName: string,
  locator: Locator,
  element: Element,
  input: ElementInput
): Promise<void> {
  const reason = await unreachableReason(
    reach,
    locator,
    element,
    latestPageStateRef,
    input
  );
  if (reason !== undefined)
    assertAvailable(toolName, { present: true, available: false, reason });
}

async function unreachableReason(
  reach: Reach,
  locator: Locator,
  element: Element,
  latestRefOf: LatestRefLookup,
  input: ElementInput
): Promise<string | undefined> {
  if (input === "focus") {
    const ref = reach.blockingAncestor(element);
    const blocker = ref && elementOfRef(ref);
    return blocker ? unfocusableReason(blocker, latestRefOf) : undefined;
  }
  const measurement = await reach.measureReachAtCall(locator, element);
  if (measurement.available) return undefined;
  return obstructionReason(inTheWayOf(measurement), latestRefOf);
}
