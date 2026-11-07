// An element filter as the runtime's options take it, as a started session
// keeps it, and as the In-page Module receives it: plain data, so it crosses
// into the document (ADR-0049). A selector is data already, matched in the
// capture. A function runs where the session does, once, when it starts: the
// Locator it returns is kept, and before each capture the host hands the
// module the elements it matches then, which the capture reads by key.
import type { Locator, Page } from "@playwright/test";

/**
 * A CSS selector, matched in the page by each capture, or a function the
 * session calls once, when it starts, with its Page, returning the Locator of
 * the elements to match: Playwright Lite's Page and Locator in the browser,
 * Playwright's in Node. The function runs where the session does, so it may
 * use anything around it; the Locator is resolved again before each capture.
 */
export type ElementFilter = string | ((page: Page) => Locator);

/** An element filter as a started session keeps it: a selector, or the Locator its function returned. */
export type SessionFilter = { selector: string } | { locator: Locator };

/**
 * An element filter as the In-page Module receives it: a selector, or the
 * key the host handed a Locator's matches under (`InPage.match`), which this
 * host's captures read.
 */
export type FilterData = { selector: string } | { matches: string };

/** A filter that a Custom Tool's refs are captured under, by the tool's name. */
export type NamedFilter<F = FilterData> = { name: string; filter: F };

/** What checking a selector found: whether the registration may go on. */
export type FilterCheck =
  { kind: "ok" } | { kind: "bad-selector"; message: string };

/**
 * Checks a selector as a registration does, before a capture matches it: it
 * must parse, which matching it against `root`, the document's root, shows.
 */
export function checkFilter(
  { selector }: { selector: string },
  root: Element
): FilterCheck {
  try {
    root.matches(selector);
    return { kind: "ok" };
  } catch (error) {
    return {
      kind: "bad-selector",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
