import type { PageActivitySource } from "@ayme-dev/core/structural-observation";

import { onlyHitTestMarks } from "../shared";

const PAGE_ACTIVITY_EVENTS = [
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

/** Returns a browser activity signal for the given document. */
export function getBrowserPageActivitySource(
  currentDocument: Document
): PageActivitySource {
  return {
    subscribe(onActivity) {
      const observer = new MutationObserver((records) => {
        if (!onlyHitTestMarks(records)) onActivity();
      });
      observer.observe(currentDocument, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });

      const listener = () => onActivity();
      for (const eventName of PAGE_ACTIVITY_EVENTS) {
        currentDocument.addEventListener(eventName, listener, {
          capture: true,
          passive: true,
        });
        currentDocument.defaultView?.addEventListener(eventName, listener, {
          capture: true,
          passive: true,
        });
      }

      return () => {
        observer.disconnect();
        for (const eventName of PAGE_ACTIVITY_EVENTS) {
          currentDocument.removeEventListener(eventName, listener, {
            capture: true,
          });
          currentDocument.defaultView?.removeEventListener(
            eventName,
            listener,
            {
              capture: true,
            }
          );
        }
      };
    },
  };
}
