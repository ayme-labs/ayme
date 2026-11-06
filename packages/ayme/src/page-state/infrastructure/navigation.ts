// The Navigation API: when a navigation a Browser Tool calls for starts, and
// whether a traversal moved. The document's in-page module watches the
// navigations themselves.
import type { Page } from "@playwright/test";
import type { Navigation } from "../application/navigation";

/**
 * Calls the browser Page's `navigate`, such as `goto` or `reload`, without
 * waiting for its outcome, which may be a load this document never sees.
 * Resolves once the navigation starts in this document, or once the call
 * ends without starting one. A Page that defers the call, as the Inspector's
 * demo mode does, so cannot leave the action settled before its navigation
 * begins. Without the Navigation API, which tells when it starts, waits for
 * the call to end; such a browser cannot answer a full load at once anyway.
 */
export async function startNavigation(
  currentDocument: Document,
  navigate: () => Promise<unknown>
): Promise<void> {
  const navigation = currentDocument.defaultView?.navigation;
  const watching = new AbortController();
  // Listening before the call, which may start the navigation at once.
  const started = new Promise<void>((resolve) =>
    navigation?.addEventListener("navigate", () => resolve(), {
      signal: watching.signal,
    })
  );
  const ended = navigate().then(
    () => {},
    () => {}
  );
  if (!navigation) return ended;
  try {
    await Promise.race([started, ended]);
  } finally {
    watching.abort();
  }
}

/**
 * The browser runtime's navigation of `currentDocument`, through the
 * Navigation API, which tells when a navigation starts. A page without it
 * waits for the call to end; such a browser cannot answer a full load at
 * once anyway.
 */
export function documentNavigation(currentDocument: Document): Navigation {
  const navigationOf = () => currentDocument.defaultView?.navigation;
  return {
    baseURI: () => currentDocument.baseURI,
    origin: () => currentDocument.location.origin,
    start: (navigate) => startNavigation(currentDocument, navigate),
    async traverse(move) {
      const navigation = navigationOf();
      // The browser Page moves through history with the Navigation API and
      // refuses with its own error without it.
      if (!navigation) {
        await move();
        return true;
      }
      // A traversal happens in a later task. One within the document commits
      // a new current entry, or fails if it is cancelled; one to another
      // document starts a full load, which the action answers. With no entry
      // to move to, the browser Page resolves at once with no navigation
      // started and the current entry unchanged. Its rejection is the answer
      // only while no navigation has started; after that, the navigation
      // answers.
      const start = navigation.currentEntry?.key;
      let navigated = false;
      const watching = new AbortController();
      const { signal } = watching;
      return new Promise<boolean>((resolve, reject) => {
        navigation.addEventListener("navigate", () => (navigated = true), {
          signal,
        });
        for (const type of ["currententrychange", "navigateerror"])
          navigation.addEventListener(type, () => resolve(true), { signal });
        void move().then(
          () => {
            if (!navigated && navigation.currentEntry?.key === start)
              resolve(false);
          },
          (error: unknown) => {
            if (!navigated && navigation.currentEntry?.key === start)
              reject(error);
          }
        );
      }).finally(() => watching.abort());
    },
  };
}

/**
 * A Node host's navigation of `page`. Playwright's own calls tell where the
 * page is; a navigation's start is told by the in-page module, whose load
 * report ends the action, so `start` has nothing to wait for but the call.
 */
export function pageNavigation(page: Page): Navigation {
  return {
    baseURI: () => page.url(),
    origin: () => new URL(page.url()).origin,
    start(navigate) {
      return navigate().then(
        () => {},
        () => {}
      );
    },
    async traverse(move) {
      const from = page.url();
      // Playwright answers null for an entry that is not there, and for one
      // within the document: only the URL tells those apart.
      const response = await move();
      return response !== null || page.url() !== from;
    },
  };
}
