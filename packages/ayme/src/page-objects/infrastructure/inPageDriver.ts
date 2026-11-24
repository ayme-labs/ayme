import type { Locator } from "@playwright/test";
import type { InPage } from "../../in-page";
import type { PageDriver } from "../application/pageDriver";

/** What every Playwright Locator, over Playwright Lite or Playwright, can do. */
const locatorMethods = ["evaluateAll", "count", "nth", "last", "locator"];

/**
 * Package-internal: the page driver over the in-page module of the page
 * `inPageOf` answers, whichever runtime drives it: the registry reads Page
 * Objects the same through Playwright Lite and through Playwright.
 */
export function inPageDriver(inPageOf: () => InPage): PageDriver {
  return {
    isLocator(value): value is Locator {
      return (
        typeof value === "object" &&
        value !== null &&
        locatorMethods.every(
          (method) =>
            typeof (value as Record<string, unknown>)[method] === "function"
        )
      );
    },
    probe: (root, label) => inPageOf().probe(root, label),
    refs: (locator) => inPageOf().mint(locator),
    currentRefs: (refs) => inPageOf().currentRefs(refs),
    elementKeys: (refs) => inPageOf().elementKeys(refs),
    keyedRefs: (keys) => inPageOf().keyedRefs(keys),
    names: (locator, ref) => inPageOf().names(locator, ref),
    watch: (probe) => inPageOf().watch(probe),
    refresh: () => inPageOf().refresh(),
    probed: () => inPageOf().probed(),
  };
}
