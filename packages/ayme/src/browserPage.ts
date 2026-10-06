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

// Playwright Lite's element reads, such as `boundingBox`, wait without limit
// unless a default timeout is set, so an action awaiting one on a locator
// that matches nothing would never answer. Setting the action timeout bounds
// them too; navigation keeps Playwright Lite's own limit, which that setting
// would otherwise replace.
const DEFAULT_ACTION_TIMEOUT = 1_000;
const DEFAULT_NAVIGATION_TIMEOUT = 30_000;

/**
 * Create the browser Page the runtime session drives by default. The compiler
 * settings are the defaults, over Ayme's own timeouts; an option the caller
 * gives wins for that option.
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
        : DEFAULT_ACTION_TIMEOUT),
    navigationTimeout:
      options.navigationTimeout ??
      (typeof __AYME_PLAYWRIGHT_NAVIGATION_TIMEOUT__ === "number"
        ? __AYME_PLAYWRIGHT_NAVIGATION_TIMEOUT__
        : DEFAULT_NAVIGATION_TIMEOUT),
  });
}
