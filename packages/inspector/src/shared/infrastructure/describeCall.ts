import type { Locator } from "@playwright/test";
import { elementsOf, kindOf, type CallSubject } from "@ayme-dev/ayme/internal";

export type { CallSubject } from "@ayme-dev/ayme/internal";

/** What demo mode does with a call that acts on the page. */
export type CallDescription = {
  /** The element demo mode cues, for a call that clicks one. */
  cue?: Locator;
  /** The elements it hit-tests, which the panel lets pointer events reach. */
  hitTargets: Locator[];
};

/**
 * What a call on the runtime's Page does, as ayme's Playwright call table
 * says: undefined for one that only reads, waits, builds a locator,
 * configures or scrolls, which runs as it is. One that acts is paced in demo mode; one
 * through the pointer is hit-tested, and a click is cued.
 */
export function describeCall(
  subject: CallSubject,
  target: object,
  method: string | symbol,
  args: unknown[]
): CallDescription | undefined {
  const kind = kindOf(subject, method);
  if (kind === undefined || kind === "none") return undefined;
  const pointer = kind === "point" || kind === "click";
  const elements = pointer
    ? elementsOf(subject, target, method as string, args)
    : [];
  return {
    ...(kind === "click" && elements[0] && { cue: elements[0] }),
    hitTargets: elements,
  };
}
