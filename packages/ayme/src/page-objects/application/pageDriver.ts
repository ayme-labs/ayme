import type { Locator } from "@playwright/test";
import type { ObservedPomRoot } from "../domain/pomInstance";

/**
 * Package-internal: what reading Page Objects needs of the page they are
 * read on. The browser runtime's is the Playwright Lite page driver.
 */
export type PageDriver = {
  /** Whether `value`, a member or a root predicate answered, is a locator. */
  isLocator(value: unknown): value is Locator;
  /** The elements `locator` resolves to now. Throws when it cannot resolve. */
  elementsOf(locator: Locator): Element[];
  /**
   * Observes one Page Object Root without scrolling or sending input, with
   * how many elements its locator matched. The root is present only while
   * the locator resolved to one visible element throughout.
   */
  observeRoot(
    locator: Locator
  ): Promise<{ count: number; root: ObservedPomRoot }>;
  /**
   * Calls `onChange` whenever the page may have changed what a Page Object
   * reads, until the watch is stopped.
   */
  watch(onChange: () => void): PageWatch;
};

export type PageWatch = {
  /** Calls `onChange` now for a change the watch has not reported yet. */
  flush(): void;
  stop(): void;
};
