import type { Locator } from "@playwright/test";
import {
  isPlaywrightLiteLocator,
  resolveLocatorElements,
} from "@ayme-dev/playwright-lite/internal";
import { getInteractionHistory } from "../page-state";
import { onlyHitTestMarks } from "../shared";
import type { PageDriver } from "./pageDriver";
import { observePomRoot } from "./pomRootObservation";

const layoutEvents = [
  "scroll",
  "resize",
  "transitionend",
  "transitioncancel",
  "animationend",
  "animationcancel",
] as const;

/**
 * Package-internal: the page driver of the browser runtime, on Playwright
 * Lite and the current document.
 */
export const litePageDriver: PageDriver = {
  isLocator(value): value is Locator {
    return isPlaywrightLiteLocator(value);
  },
  elementsOf: (locator) => resolveLocatorElements(locator),
  observeRoot: (locator) => observePomRoot(locator),
  watch(onChange) {
    const mutations = new MutationObserver((records) => {
      if (!onlyHitTestMarks(records)) onChange();
    });
    mutations.observe(document.documentElement, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    const view = document.defaultView;
    for (const event of layoutEvents)
      view?.addEventListener(event, onChange, true);
    // A same-document navigation changes no DOM by itself, but a presence
    // predicate may read the URL: the Page State Session's Visit signal.
    const stopWatchingNavigations =
      getInteractionHistory(document).onNavigation(onChange);
    return {
      flush() {
        // A change made in this task has not reached the observer's
        // callback yet.
        const records = mutations.takeRecords();
        if (records.length && !onlyHitTestMarks(records)) onChange();
      },
      stop() {
        for (const event of layoutEvents)
          view?.removeEventListener(event, onChange, true);
        stopWatchingNavigations();
        mutations.disconnect();
      },
    };
  },
};
