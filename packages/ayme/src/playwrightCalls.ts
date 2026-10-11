import type { Keyboard, Locator, Mouse, Page } from "@playwright/test";

/** What a call is made on: a locator, the Page, or the Page's keyboard or mouse. */
export type CallSubject = "locator" | "page" | "keyboard" | "mouse";

/**
 * What a Playwright call does to the page, for every reader of a call on
 * the runtime's Page: Interaction recording, and the Inspector's demo
 * feedback.
 * - `none` reads, waits, builds a locator or configures; it runs as it is.
 * - `navigate` is one of the Page's navigations: it acts on no element
 *   and is not an Interaction.
 * - `act` acts on the page but is no input (a blur, a focus, a scroll):
 *   demo mode pauses before it; recording ignores it.
 * - `input` is an Interaction that is not through the pointer: a fill, a
 *   key press, a selection, the keyboard's and the mouse's calls.
 * - `point` is an Interaction through the pointer, so demo mode also
 *   hit-tests its elements.
 * - `click` is a pointer Interaction that clicks its element, so demo mode
 *   also cues it.
 */
export type CallKind =
  "none" | "navigate" | "act" | "input" | "point" | "click";

/** The names of `T`'s methods, so a misspelt one fails typecheck. */
type Methods<T> = Extract<
  {
    [K in keyof T]-?: T[K] extends (...args: never[]) => unknown ? K : never;
  }[keyof T],
  string
>;

// Every method of Playwright's Locator, Page, Keyboard and Mouse, so a
// Playwright release that adds one fails typecheck here until it is
// classified, and nowhere else.

const locatorCalls = {
  all: "none",
  allInnerTexts: "none",
  allTextContents: "none",
  and: "none",
  ariaSnapshot: "none",
  ariaSnapshotJSON: "none",
  blur: "act",
  boundingBox: "none",
  check: "click",
  clear: "input",
  click: "click",
  contentFrame: "none",
  count: "none",
  dblclick: "click",
  describe: "none",
  description: "none",
  dispatchEvent: "input",
  dragTo: "point",
  drop: "input",
  elementHandle: "none",
  elementHandles: "none",
  evaluate: "none",
  evaluateAll: "none",
  evaluateHandle: "none",
  fill: "input",
  filter: "none",
  first: "none",
  focus: "act",
  frameLocator: "none",
  getAttribute: "none",
  getByAltText: "none",
  getByLabel: "none",
  getByPlaceholder: "none",
  getByRole: "none",
  getByTestId: "none",
  getByText: "none",
  getByTitle: "none",
  hideHighlight: "none",
  highlight: "none",
  hover: "point",
  innerHTML: "none",
  innerText: "none",
  inputValue: "none",
  isChecked: "none",
  isDisabled: "none",
  isEditable: "none",
  isEnabled: "none",
  isHidden: "none",
  isVisible: "none",
  last: "none",
  locator: "none",
  normalize: "none",
  nth: "none",
  or: "none",
  page: "none",
  press: "input",
  pressSequentially: "input",
  screenshot: "none",
  scrollIntoViewIfNeeded: "act",
  selectOption: "input",
  selectText: "input",
  setChecked: "click",
  setInputFiles: "input",
  tap: "click",
  textContent: "none",
  toString: "none",
  type: "input",
  uncheck: "click",
  visible: "none",
  waitFor: "none",
  waitForFunction: "none",
  within: "none",
} as const satisfies Record<Methods<Locator>, CallKind>;

/** The Page's actions take their element's selector first; its navigations take none. */
const pageCalls = {
  $: "none",
  $$: "none",
  $eval: "none",
  $$eval: "none",
  addInitScript: "none",
  addListener: "none",
  addLocatorHandler: "none",
  addScriptTag: "none",
  addStyleTag: "none",
  ariaSnapshot: "none",
  ariaSnapshotJSON: "none",
  bringToFront: "none",
  cancelPickLocator: "none",
  check: "click",
  clearConsoleMessages: "none",
  clearPageErrors: "none",
  click: "click",
  close: "none",
  consoleMessages: "none",
  content: "none",
  context: "none",
  dblclick: "click",
  dispatchEvent: "input",
  dragAndDrop: "point",
  emulateMedia: "none",
  evaluate: "none",
  evaluateHandle: "none",
  exposeBinding: "none",
  exposeFunction: "none",
  fill: "input",
  focus: "act",
  frame: "none",
  frameLocator: "none",
  frames: "none",
  getAttribute: "none",
  getByAltText: "none",
  getByLabel: "none",
  getByPlaceholder: "none",
  getByRef: "none",
  getByRole: "none",
  getByTestId: "none",
  getByText: "none",
  getByTitle: "none",
  goBack: "navigate",
  goForward: "navigate",
  goto: "navigate",
  hideHighlight: "none",
  hover: "point",
  innerHTML: "none",
  innerText: "none",
  inputValue: "none",
  isChecked: "none",
  isClosed: "none",
  isDisabled: "none",
  isEditable: "none",
  isEnabled: "none",
  isHidden: "none",
  isVisible: "none",
  locator: "none",
  mainFrame: "none",
  off: "none",
  on: "none",
  once: "none",
  opener: "none",
  pageErrors: "none",
  pause: "none",
  pdf: "none",
  pickLocator: "none",
  prependListener: "none",
  press: "input",
  reload: "navigate",
  removeAllListeners: "none",
  removeListener: "none",
  removeLocatorHandler: "none",
  requestGC: "none",
  requests: "none",
  route: "none",
  routeFromHAR: "none",
  routeWebSocket: "none",
  screenshot: "none",
  selectOption: "input",
  setChecked: "click",
  setContent: "none",
  setDefaultNavigationTimeout: "none",
  setDefaultTimeout: "none",
  setExtraHTTPHeaders: "none",
  setInputFiles: "input",
  setViewportSize: "none",
  tap: "click",
  textContent: "none",
  title: "none",
  type: "input",
  uncheck: "click",
  unroute: "none",
  unrouteAll: "none",
  url: "none",
  video: "none",
  viewportSize: "none",
  waitForEvent: "none",
  waitForFunction: "none",
  waitForLoadState: "none",
  waitForNavigation: "none",
  waitForRequest: "none",
  waitForResponse: "none",
  waitForSelector: "none",
  waitForTimeout: "none",
  waitForURL: "none",
  workers: "none",
} as const satisfies Record<Methods<Page>, CallKind>;

// The input devices act on no element, so there is nothing to hit-test or cue.
const keyboardCalls = {
  down: "input",
  insertText: "input",
  press: "input",
  type: "input",
  up: "input",
} as const satisfies Record<Methods<Keyboard>, CallKind>;

const mouseCalls = {
  click: "input",
  dblclick: "input",
  down: "input",
  move: "input",
  up: "input",
  wheel: "input",
} as const satisfies Record<Methods<Mouse>, CallKind>;

export const playwrightCalls: Record<
  CallSubject,
  Readonly<Record<string, CallKind>>
> = {
  locator: locatorCalls,
  page: pageCalls,
  keyboard: keyboardCalls,
  mouse: mouseCalls,
};

/** What a call does, or undefined for a symbol-keyed or unknown method, which runs as it is. */
export function kindOf(
  subject: CallSubject,
  method: string | symbol
): CallKind | undefined {
  const table: Readonly<Record<PropertyKey, CallKind>> =
    playwrightCalls[subject];
  return Object.hasOwn(table, method) ? table[method] : undefined;
}

/** Whether a call of this kind is an Interaction: an input a Run gave the page. */
export function isInteraction(kind: CallKind | undefined): boolean {
  return kind === "input" || kind === "point" || kind === "click";
}

/**
 * The elements a call acts on: a locator itself, and a drag's drop target;
 * the elements the Page's selectors name, two for a drag and drop and none
 * for a navigation. The input devices act on none.
 */
export function elementsOf(
  subject: CallSubject,
  target: object,
  method: string,
  args: readonly unknown[]
): Locator[] {
  if (subject === "locator") {
    // dragTo's first argument is the drop target's locator.
    const dropTarget = method === "dragTo" ? (args[0] as Locator) : undefined;
    return dropTarget ? [target as Locator, dropTarget] : [target as Locator];
  }
  if (subject !== "page" || kindOf(subject, method) === "navigate") return [];
  return args
    .slice(0, method === "dragAndDrop" ? 2 : 1)
    .filter((arg): arg is string => typeof arg === "string")
    .map((selector) => (target as Page).locator(selector));
}

/**
 * The value a call was given, e.g. a fill's text or a pressed key: a
 * locator's or a device's first argument, the Page's second, after its
 * selector. A drag and drop names two elements and has no value.
 */
export function valueOf(
  subject: CallSubject,
  method: string,
  args: readonly unknown[]
): unknown {
  if (method === "dragAndDrop") return undefined;
  return subject === "page" ? args[1] : args[0];
}
