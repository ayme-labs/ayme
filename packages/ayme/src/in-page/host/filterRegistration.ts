// Registering an element filter when a session starts: a selector is checked
// where the module matches it (the browser runtime, whose realm is the page,
// checks it itself; a Node host asks through the slot's `check`), and kept as
// data. A function is called once, with the session's Page, where the session
// runs, and the Locator it returns is kept, for the host to resolve before
// each capture.
import type { Locator, Page } from "@playwright/test";

import {
  checkFilter,
  ToolInputError,
  type ElementFilter,
  type FilterCheck,
  type SessionFilter,
} from "../../shared";

/**
 * `filter` for a registration named `name`, as "`ignore`" or "`filter` of
 * the Custom Tool `x`", in the browser runtime: a selector checked against
 * `root`, the page's root element, in the page's own realm, or the Locator a
 * function returns for `page`. Throws a `ToolInputError` for a selector that
 * does not parse, and for a function that throws or returns no Locator.
 */
export function registerFilter(
  name: string,
  filter: ElementFilter,
  { page, root }: { page: Page; root: Element }
): SessionFilter {
  if (typeof filter !== "string") return locatorOf(name, filter, page);
  return checkedSelector(name, filter, checkFilter({ selector: filter }, root));
}

/**
 * `filter` for a registration named `name` on `page`, as a Node host
 * registers it: a selector checked where the module matches it, asked
 * through the slot's `check`, or the Locator a function returns for `page`.
 * Rejects as `registerFilter` throws.
 */
export async function registerFilterThrough(
  check: (filter: { selector: string }) => Promise<FilterCheck>,
  name: string,
  filter: ElementFilter,
  page: Page
): Promise<SessionFilter> {
  if (typeof filter !== "string") return locatorOf(name, filter, page);
  return checkedSelector(name, filter, await check({ selector: filter }));
}

function checkedSelector(
  name: string,
  selector: string,
  check: FilterCheck
): SessionFilter {
  if (check.kind === "bad-selector")
    throw new ToolInputError(
      `The ${name} is not a valid CSS selector: ${check.message}`
    );
  return { selector };
}

/** The Locator `filter` returns for `page`, or the `ToolInputError` that says why it gave none. */
function locatorOf(
  name: string,
  filter: (page: Page) => Locator,
  page: Page
): SessionFilter {
  let locator: unknown;
  try {
    locator = filter(page);
  } catch (error) {
    throw new ToolInputError(
      `The ${name} function threw when the session started: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  if (!isLocator(locator))
    throw new ToolInputError(
      `The ${name} function did not return a Locator. It is called once, when the session starts, with the session's Page, and returns a Locator of it, such as \`(page) => page.getByRole("dialog")\`.`
    );
  return { locator };
}

/** What every Playwright Locator, over Playwright Lite or Playwright, can do. */
const locatorMethods = ["evaluateAll", "count", "nth", "last", "locator"];

/** Whether `value` is a Locator: Playwright's public API has no brand to test, so its shape tells. */
function isLocator(value: unknown): value is Locator {
  return (
    typeof value === "object" &&
    value !== null &&
    locatorMethods.every(
      (method) =>
        typeof (value as Record<string, unknown>)[method] === "function"
    )
  );
}
