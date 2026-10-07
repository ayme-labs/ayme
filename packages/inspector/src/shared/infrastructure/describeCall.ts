import type { Locator, Page } from "@playwright/test";

import {
  keyboardCalls,
  locatorCalls,
  mouseCalls,
  navigations,
  pageCalls,
  type CallKind,
} from "../domain/playwrightCalls";

/** What a call is made on: a locator, the Page, or the Page's keyboard or mouse. */
export type CallSubject = "locator" | "page" | "keyboard" | "mouse";

/** What demo mode does with a call that acts on the page. */
export type CallDescription = {
  /** The element demo mode cues, for a call that clicks one. */
  cue?: Locator;
  /** The elements it hit-tests, which the panel lets pointer events reach. */
  hitTargets: Locator[];
};

const tables: Record<CallSubject, Record<string, CallKind>> = {
  locator: locatorCalls,
  page: pageCalls,
  keyboard: keyboardCalls,
  mouse: mouseCalls,
};

/**
 * What a call on the runtime's Page does: undefined for one that only
 * reads, waits, builds a locator or configures, which runs as it is. One
 * that acts is paced in demo mode.
 */
export function describeCall(
  subject: CallSubject,
  target: object,
  method: string | symbol,
  args: unknown[]
): CallDescription | undefined {
  if (typeof method !== "string") return undefined;
  const kind = Object.hasOwn(tables[subject], method)
    ? tables[subject][method]
    : undefined;
  if (kind === undefined || kind === "none") return undefined;

  // The Page's actions, but not its navigations, take a selector first.
  const bySelector = subject === "page" && !navigations.has(method);
  const element =
    subject === "locator"
      ? (target as Locator)
      : bySelector && typeof args[0] === "string"
        ? (target as Page).locator(args[0])
        : undefined;
  const pointer = kind === "point" || kind === "click";
  return {
    ...(kind === "click" && element && { cue: element }),
    hitTargets: pointer ? hitTargets(subject, target, method, args) : [],
  };
}

// A locator's own element and a drag's drop target, or the elements the
// Page's selectors name.
function hitTargets(
  subject: CallSubject,
  target: object,
  method: string,
  args: unknown[]
): Locator[] {
  if (subject === "locator")
    // dragTo's first argument is the drop target's locator.
    return method === "dragTo" && args[0]
      ? [target as Locator, args[0] as Locator]
      : [target as Locator];
  if (subject !== "page") return [];
  return args
    .slice(0, method === "dragAndDrop" ? 2 : 1)
    .filter((arg): arg is string => typeof arg === "string")
    .map((selector) => (target as Page).locator(selector));
}
