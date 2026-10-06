import type { Locator } from "@playwright/test";
import type { JsonValue } from "./contracts";
import type { Caller, ToolCall } from "./interactionHistory";

/**
 * What the registry learnt about one Page Object Root: how many elements its
 * locator matches, and the ADR-0020 pair, Presence and Availability. A driver
 * that runs inside the document also hands the element itself, so structural
 * capture can label it and collection tools can find their instance by it; a
 * driver outside the document leaves it out.
 */
export type RootObservation = {
  count: number;
  present: boolean;
  available: boolean;
  element?: Element;
};

/**
 * The port between the Page Object registry and the runtime that drives the
 * page. The registry owns registrations, probing, the activation rule and the
 * live tool set; a driver owns everything that differs between running inside
 * the document on Playwright Lite and running in Node over Playwright.
 *
 * `Result` is what running a tool answers: the browser answers with the
 * action result (Settled Page, Change Record); a Node driver decides its own.
 */
export type PageDriver<Result extends JsonValue = JsonValue> = {
  /** Whether a member's value is a locator of this driver's Page. */
  isLocator(value: unknown): value is Locator;
  /** Observe one declared root; never scrolls, clicks or focuses (ADR-0019). */
  observeRoot(root: Locator): Promise<RootObservation>;
  /**
   * Call `onChange` whenever the page may have changed; the registry
   * coalesces the calls into one probe. The returned function stops watching.
   * Called when the first Page Object registers; stopped when the last goes.
   */
  watch(onChange: () => void): () => void;
  /** Run one tool call the way this runtime runs actions. */
  run(perform: () => unknown, call: ToolCall, caller: Caller): Promise<Result>;
  /**
   * The elements a locator matches right now, for structural capture and
   * collection tools. A driver outside the document has none to give.
   */
  locatorElements?(locator: Locator): Element[];
  /**
   * The element a Structural Ref names, or why it names none, for tools that
   * go through a collection. Without it, those tools report that this runtime
   * cannot address an item.
   */
  resolveRef?(ref: string): Promise<{ element: Element } | { reason: string }>;
};
