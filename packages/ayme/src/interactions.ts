import type { Keyboard, Locator, Mouse, Page } from "@playwright/test";

/**
 * A call a Run made on the runtime's Page that acts on the page or waits for
 * it: a click, a fill, a key press, a hover, a selection, a `waitFor`.
 */
export type Interaction = Readonly<{
  /** The method, e.g. "click", or "keyboard.press" for the keyboard's. */
  operation: string;
  /** The locator it acted on; absent for the keyboard, the mouse and navigations. */
  locator?: string;
  /** The value it was given, e.g. a fill's text or a pressed key. */
  value?: string;
  /** The state a `waitFor` waits for. */
  state?: string;
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

// The calls that are Interactions. Every other call reads, builds a locator
// or configures, and is not one.
const interactionCalls: Record<CallSubject, ReadonlySet<string>> = {
  locator: new Set<Methods<Locator> | "_expect">([
    // `_expect` runs an `expect(locator)` assertion.
    "_expect",
    "blur",
    "check",
    "clear",
    "click",
    "dblclick",
    "dispatchEvent",
    "dragTo",
    "drop",
    "fill",
    "focus",
    "hover",
    "press",
    "pressSequentially",
    "scrollIntoViewIfNeeded",
    "selectOption",
    "selectText",
    "setChecked",
    "setInputFiles",
    "tap",
    "type",
    "uncheck",
    "waitFor",
  ]),
  page: new Set<Methods<Page>>([
    "check",
    "click",
    "dblclick",
    "dispatchEvent",
    "dragAndDrop",
    "fill",
    "focus",
    "goBack",
    "goForward",
    "goto",
    "hover",
    "press",
    "reload",
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

/** The Page's navigations: they act on no element. */
const navigations = new Set(["goBack", "goForward", "goto", "reload"]);

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
  // The Page's actions, but not its navigations, take a selector first.
  const bySelector = subject === "page" && !navigations.has(method);
  const locator =
    subject === "locator"
      ? (target as Locator)
      : bySelector && typeof args[0] === "string"
        ? (target as Page).locator(args[0])
        : undefined;
  const value = bySelector ? args[1] : args[0];
  return {
    operation:
      method === "_expect"
        ? "expect"
        : subject === "keyboard" || subject === "mouse"
          ? `${subject}.${method}`
          : method,
    ...(locator && { locator: locator.toString() }),
    ...(typeof value === "string" && method !== "_expect" && { value }),
    ...(method === "waitFor" && {
      state: (args[0] as { state?: string } | undefined)?.state ?? "visible",
    }),
  };
}
