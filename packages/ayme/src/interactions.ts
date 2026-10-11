import {
  elementsOf,
  isInteraction,
  kindOf,
  valueOf,
  type CallSubject,
} from "./playwrightCalls";

export type { CallSubject } from "./playwrightCalls";

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

/**
 * Package-internal: the Interaction a call on the runtime's Page is, or
 * undefined for a call that is not one. The Playwright call table says
 * which calls are, and where their element and value sit.
 */
export function interactionOf(
  subject: CallSubject,
  target: object,
  method: string | symbol,
  args: readonly unknown[]
): Interaction | undefined {
  if (!isInteraction(kindOf(subject, method))) return undefined;
  const [locator] = elementsOf(subject, target, method as string, args);
  const value = valueOf(subject, method as string, args);
  return {
    operation:
      subject === "keyboard" || subject === "mouse"
        ? `${subject}.${method as string}`
        : (method as string),
    ...(locator && { locator: locator.toString() }),
    ...(typeof value === "string" && { value }),
  };
}
