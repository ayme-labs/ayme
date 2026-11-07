// Stryker disable all
// The document's activity watcher, one per document, armed when its module
// is installed: what a Settled Page waits out (ADR-0024). Its listeners hear
// of activity in batches, one call per batch of mutations the observer
// delivers, and never across documents: a new document arms its own.
import type { PageActivitySource } from "@ayme-dev/core/structural-observation";

import { onlyOwnMarks } from "../../shared";

/** The events that are activity besides mutations. */
const activityEvents = [
  "transitionrun",
  "transitionstart",
  "transitionend",
  "transitioncancel",
  "animationstart",
  "animationiteration",
  "animationend",
  "animationcancel",
  "scroll",
  "resize",
] as const;

/**
 * Watches `target` from now on: its DOM mutations, and the transition,
 * animation, scroll and resize events of it and its window.
 */
export function watchActivity(target: Document): PageActivitySource {
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  new MutationObserver((records) => {
    // Ayme's and Playwright's own marks are no activity of the page.
    if (!onlyOwnMarks(records)) notify();
  }).observe(target, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  for (const type of activityEvents)
    for (const eventTarget of [target, target.defaultView])
      eventTarget?.addEventListener(type, notify, {
        capture: true,
        passive: true,
      });
  return {
    subscribe(listener) {
      const subscribed = () => listener();
      listeners.add(subscribed);
      return () => {
        listeners.delete(subscribed);
      };
    },
  };
}
