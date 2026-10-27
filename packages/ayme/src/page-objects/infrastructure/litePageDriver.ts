import type { Locator } from "@playwright/test";
import {
  isPlaywrightLiteLocator,
  resolveLocatorElements,
} from "@ayme-dev/playwright-lite/internal";
import {
  geometryReach,
  getInteractionHistory,
  latestPageStateRef,
  onPageStateRecorded,
  type Reach,
} from "../../page-state";
import { onlyHitTestMarks } from "../../shared";
import type { PageDriver } from "../application/pageDriver";
import { observePomRoot } from "./pomRootObservation";

const layoutEvents = [
  "scroll",
  "resize",
  "transitionend",
  "transitioncancel",
  "animationend",
  "animationcancel",
] as const;

// The Reach the started runtime picked, which observing a root measures
// with: the one registry is built once, before any runtime starts. Only
// this adapter reads it; a Run carries its own.
let installedReach: Reach = geometryReach;

/**
 * Package-internal: install the Reach the Lite page driver measures Page
 * Object Roots with, or Chromium's geometry again. Called by the runtime's
 * `start()` and `stop()`.
 */
export function installPageDriverReach(reach: Reach | undefined): void {
  installedReach = reach ?? geometryReach;
}

/**
 * Package-internal: the page driver of the browser runtime, on Playwright
 * Lite and the current document.
 */
export const litePageDriver: PageDriver = {
  isLocator(value): value is Locator {
    return isPlaywrightLiteLocator(value);
  },
  elementsOf: (locator) => resolveLocatorElements(locator),
  observeRoot: (locator) => observePomRoot(locator, installedReach),
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
  onPageStateRecorded: (onRecorded) =>
    onPageStateRecorded(document, onRecorded),
  latestPageStateRef,
};
