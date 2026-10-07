import type { Keyboard, Locator, Mouse, Page } from "@playwright/test";

/**
 * One input a Run gave the page through the runtime's Page: a click, fill,
 * key press, hover or selection on one element, or a keyboard or mouse
 * input. Waits, assertions, scrolls, focus changes and navigations are not
 * Interactions.
 */
export type Interaction = Readonly<{
  /** The method, e.g. "click", or "keyboard.press" for the keyboard's. */
  operation: string;
  /** The locator it acted on; absent for the keyboard and the mouse. */
  locator?: string;
  /** The value it was given, e.g. a fill's text or a pressed key. */
  value?: string;
}>;

/** What a call is made on: a locator, the Page, or the Page's keyboard or mouse. */
export type CallSubject = "locator" | "page" | "keyboard" | "mouse";

/** The names of `T`'s methods, so a misspelt one fails typecheck. */
type Methods<T> = Extract<
  {
    [K in keyof T]-?: T[K] extends (...args: never[]) => unknown ? K : never;
  }[keyof T],
  string
>;

// The calls that are Interactions: the inputs. Every other call reads,
// waits, asserts, scrolls, moves focus, navigates, builds a locator or
// configures, and is not one.
const interactionCalls: Record<CallSubject, ReadonlySet<string>> = {
  locator: new Set<Methods<Locator>>([
    "check",
    "clear",
    "click",
    "dblclick",
    "dispatchEvent",
    "dragTo",
    "drop",
    "fill",
    "hover",
    "press",
    "pressSequentially",
    "selectOption",
    "selectText",
    "setChecked",
    "setInputFiles",
    "tap",
    "type",
    "uncheck",
  ]),
  page: new Set<Methods<Page>>([
    "check",
    "click",
    "dblclick",
    "dispatchEvent",
    "dragAndDrop",
    "fill",
    "hover",
    "press",
    "selectOption",
    "setChecked",
    "setInputFiles",
    "tap",
    "type",
    "uncheck",
  ]),
  keyboard: new Set<Methods<Keyboard>>([
    "down",
    "insertText",
    "press",
    "type",
    "up",
  ]),
  mouse: new Set<Methods<Mouse>>([
    "click",
    "dblclick",
    "down",
    "move",
    "up",
    "wheel",
  ]),
};

/**
 * Package-internal: the Interaction a call on the runtime's Page is, or
 * undefined for a call that is not one.
 */
export function interactionOf(
  subject: CallSubject,
  target: object,
  method: string | symbol,
  args: readonly unknown[]
): Interaction | undefined {
  if (typeof method !== "string" || !interactionCalls[subject].has(method))
    return undefined;
  // The Page's inputs take a selector first.
  const locator =
    subject === "locator"
      ? (target as Locator)
      : subject === "page" && typeof args[0] === "string"
        ? (target as Page).locator(args[0])
        : undefined;
  const value = subject === "page" ? args[1] : args[0];
  return {
    operation:
      subject === "keyboard" || subject === "mouse"
        ? `${subject}.${method}`
        : method,
    ...(locator && { locator: locator.toString() }),
    ...(typeof value === "string" && { value }),
  };
}
