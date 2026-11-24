import type { Locator, Page } from "@playwright/test";
import { inPage } from "../../in-page";
import { RefResolutionError } from "../../shared";
import {
  assertAvailable,
  obstructionReason,
  unfocusableReason,
} from "../domain/toolAvailability";
import type { Reach, ReachInput } from "../application/reach";

/**
 * Package-internal: the input a tool sends its element. A click needs to
 * reach it (ADR-0035); keyboard input needs only that it can take focus,
 * which an open modal it is not in or an inert ancestor prevents.
 */
export type ElementInput = ReachInput;

/**
 * Package-internal: the Structural Ref of each element `locator` matches on
 * `page`, in the page's order, read in the page in one task. An element no
 * capture has named is given a ref, a synthetic one, that `ayme-ref=` then
 * resolves.
 */
export function refsOfLocator(page: Page, locator: Locator): Promise<string[]> {
  return inPage(page).mint(locator);
}

/**
 * Package-internal: refuses the call of `toolName` that sends `input` to the
 * element `ref` names on `page`, when the input would not reach it as
 * `reach` measures it, with the Availability Reason a Page Object Tool
 * gives: the same measurement and wording as a Page Object Root's
 * (ADR-0035), which never names a kind of widget. A click's reach is
 * measured where the click would land: the element is scrolled into view
 * first, as the call's own action scrolls it, which also moves an element
 * only partly shown.
 */
export async function assertReachable(
  reach: Reach,
  page: Page,
  toolName: string,
  ref: string,
  input: ElementInput
): Promise<void> {
  const reason = await unreachableReason(reach, page, ref, input);
  if (reason !== undefined)
    assertAvailable(toolName, { present: true, available: false, reason });
}

/**
 * Package-internal: `assertReachable` for the one element `locator` matches,
 * such as a Page Object Root's, which has no ref of its own to hand; it measures
 * the first element the locator matches.
 */
export async function assertLocatorReachable(
  reach: Reach,
  page: Page,
  toolName: string,
  locator: Locator,
  input: ElementInput
): Promise<void> {
  // The element a root observation reads: the first the locator matches.
  const [ref] = await inPage(page).mint(locator);
  if (ref === undefined)
    throw new RefResolutionError(
      `${toolName} is unavailable: its locator matches no element.`
    );
  await assertReachable(reach, page, toolName, ref, input);
}

async function unreachableReason(
  reach: Reach,
  page: Page,
  ref: string,
  input: ElementInput
): Promise<string | undefined> {
  if (input === "focus") {
    const blocker = await reach.blockingAncestor(page, ref);
    return blocker ? unfocusableReason(blocker.inTheWay) : undefined;
  }
  const measurement = await reach.measureReachAtCall(page, ref);
  if (measurement.available) return undefined;
  return obstructionReason(measurement.inTheWay);
}
