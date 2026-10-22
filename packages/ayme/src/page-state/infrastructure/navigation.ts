// The Navigation API and the History API: when a navigation starts, and
// whether it stays in the document.

/**
 * Call `onNavigate` after every same-document navigation: through the
 * Navigation API where the browser has one, otherwise through `popstate`,
 * `hashchange` (a fragment navigation such as assigning `location.hash`) and
 * wrapped `history.pushState` / `replaceState`, which fire no event. A URL
 * reported twice is recorded once.
 */
export function watchSameDocumentNavigations(
  view: Window,
  onNavigate: () => void
) {
  const navigation = (
    view as Window & {
      navigation?: Pick<EventTarget, "addEventListener">;
    }
  ).navigation;
  if (navigation) {
    navigation.addEventListener("currententrychange", onNavigate);
    return;
  }
  view.addEventListener("popstate", onNavigate);
  view.addEventListener("hashchange", onNavigate);
  const history = view.history;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args) {
      original.apply(this, args);
      onNavigate();
    };
  }
}

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
 * Watch `currentDocument`'s navigations until `stop`: `started` resolves with
 * the destination URL once one starts a full load. A navigation that stays in
 * the document leaves it pending: a fragment change, a same-document
 * traversal, or one a listener intercepted, such as a router. So does one a
 * listener cancelled, and a download.
 *
 * Whether a listener intercepted it is known only after every listener ran.
 * An action starts its navigations from script, so the event is dispatched
 * on that script's stack and a microtask reads the outcome as soon as
 * dispatch has ended; the answer follows as fast as the capture allows. A
 * cross-document traversal cannot be intercepted, so for one the listeners'
 * order does not matter.
 */
export function watchFullLoad(currentDocument: Document): {
  started: Promise<string>;
  stop(): void;
} {
  let resolveStarted!: (url: string) => void;
  const started = new Promise<string>((resolve) => {
    resolveStarted = resolve;
  });
  const navigation = currentDocument.defaultView?.navigation;
  if (!navigation) return { started, stop: () => {} };
  const watching = new AbortController();
  const { signal } = watching;
  navigation.addEventListener(
    "navigate",
    (event) => {
      if (event.destination.sameDocument || event.downloadRequest !== null)
        return;
      queueMicrotask(() => {
        // An intercepted navigation is in transition until its handlers end.
        const intercepted = navigation.transition !== null;
        if (!signal.aborted && !intercepted && !event.defaultPrevented)
          resolveStarted(event.destination.url);
      });
    },
    { signal }
  );
  return { started, stop: () => watching.abort() };
}
