// Whether a call would run, and the refusal when it would not: shared by
// Browser Tools that act on one element and by Page Object Tools.

import type { AriaRef } from "@ayme-dev/core/structural-observation";
import { asSentence, RuntimeStateError } from "../../shared";

/**
 * Package-internal: whether a tool, or an action on one Page Object
 * instance, can be offered and run now (ADR-0035): `present` while its Page
 * Object is, so it is listed; `available` while a call would run it;
 * otherwise `reason`, the Availability Reason, when there is one.
 */
export type ToolAvailability = {
  present: boolean;
  available: boolean;
  reason?: string;
};

/**
 * Package-internal: the Structural Ref the agent's latest page state gave
 * `element`, if any; how an Availability Reason names what is in the way.
 */
export type LatestRefLookup = (element: Element) => AriaRef | undefined;

/**
 * Package-internal: refuses a call of the tool `toolName` that `availability`
 * says would not run, the tool's own or the one on the instance the call
 * names: `<tool> is unavailable: <reason>.`, or without the reason when there
 * is none.
 */
export function assertAvailable(
  toolName: string,
  availability: ToolAvailability
) {
  if (availability.available) return;
  throw unavailableError(toolName, availability);
}

/**
 * Package-internal: the error `assertAvailable` refuses a call with, for a
 * caller that has found the call cannot run.
 */
export function unavailableError(
  toolName: string,
  { present, reason }: Pick<ToolAvailability, "present" | "reason">
) {
  const why = present ? reason : "its Page Object is not on the page";
  return new RuntimeStateError(
    why === undefined
      ? `${toolName} is unavailable.`
      : asSentence(`${toolName} is unavailable: ${why}`)
  );
}

/**
 * Package-internal: the runtime's Availability Reason for a present element a
 * click would not reach: it names the Structural Ref of the first element in
 * the way the agent's latest page state gave one.
 */
export function obstructionReason(
  inTheWay: readonly Element[],
  latestRefOf: LatestRefLookup
) {
  const ref = inTheWay.map(latestRefOf).find((ref) => ref !== undefined);
  return ref === undefined
    ? "a click would not reach it"
    : `a click would not reach it; ${ref} is in the way`;
}

/**
 * Package-internal: the runtime's Availability Reason for an element a tool
 * types into or selects in that cannot take focus: it names the Structural
 * Ref of `blocker`, the open modal or inert ancestor in the way, when the
 * agent's latest page state gave it one.
 */
export function unfocusableReason(
  blocker: Element,
  latestRefOf: LatestRefLookup
) {
  const ref = latestRefOf(blocker);
  return ref === undefined
    ? "it cannot take focus"
    : `it cannot take focus; ${ref} is in the way`;
}
