import type { PageActivitySource } from "@ayme-dev/core/structural-observation";

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

const pageActivitySources = new WeakMap<Document, PageActivitySource>();

/** Returns a browser activity signal for the given document. */
export function getBrowserPageActivitySource(
  currentDocument: Document = document
): PageActivitySource {
  let source = pageActivitySources.get(currentDocument);
  if (!source) {
    source = createBrowserPageActivitySource(currentDocument);
    pageActivitySources.set(currentDocument, source);
  }
  return source;
}

function createBrowserPageActivitySource(
  currentDocument: Document
): PageActivitySource {
  return {
    subscribe(onActivity) {
      const observer = new MutationObserver(() => onActivity());
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
