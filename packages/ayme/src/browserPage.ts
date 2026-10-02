import { createPage as createBrowserPage } from "@ayme-dev/playwright-lite";
import type { Page } from "@playwright/test";

declare const __AYME_PLAYWRIGHT_TEST_ID_ATTRIBUTE__: string | undefined;
declare const __AYME_PLAYWRIGHT_ACTION_TIMEOUT__: number | undefined;
declare const __AYME_PLAYWRIGHT_NAVIGATION_TIMEOUT__: number | undefined;

/** The page settings the compiler defines cover; each one is optional. */
export type CreatePageOptions = {
  testIdAttribute?: string;
  actionTimeout?: number;
  navigationTimeout?: number;
};

/**
 * Create the browser Page the runtime session drives by default. The compiler
 * settings are the defaults; an option the caller gives wins for that option.
 * Resolve compiler settings at browser Page creation, never during SSR import.
 */
export function createPage(options: CreatePageOptions = {}): Page {
  return createBrowserPage({
    testIdAttribute:
      options.testIdAttribute ??
      (typeof __AYME_PLAYWRIGHT_TEST_ID_ATTRIBUTE__ === "string"
        ? __AYME_PLAYWRIGHT_TEST_ID_ATTRIBUTE__
        : undefined),
    actionTimeout:
      options.actionTimeout ??
      (typeof __AYME_PLAYWRIGHT_ACTION_TIMEOUT__ === "number"
        ? __AYME_PLAYWRIGHT_ACTION_TIMEOUT__
        : undefined),
    navigationTimeout:
      options.navigationTimeout ??
      (typeof __AYME_PLAYWRIGHT_NAVIGATION_TIMEOUT__ === "number"
        ? __AYME_PLAYWRIGHT_NAVIGATION_TIMEOUT__
        : undefined),
  });
}
