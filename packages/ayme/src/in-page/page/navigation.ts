// Stryker disable all
// The document's navigation watcher, one per document, armed when its module
// is installed: the navigations that stay in the document, for Visits, and
// the start of a full load, which ends the actions in flight.

/**
 * Calls `onNavigate` after every same-document navigation of `view`'s
 * document: through the Navigation API where the browser has one, otherwise
 * through `popstate`, `hashchange` (a fragment navigation such as assigning
 * `location.hash`) and wrapped `history.pushState` / `replaceState`, which
 * fire no event.
 */
export function watchSameDocumentNavigations(
  view: Window,
  onNavigate: () => void
): void {
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
 * Calls `onLoad` with the destination URL each time a navigation of `view`
 * starts a full load of another document. A navigation that stays in the
 * document does not: a fragment change, a same-document traversal, or one a
 * listener intercepted, such as a router. Nor does one a listener cancelled,
 * or a download. Without the Navigation API no full load is told.
 *
 * Whether a listener intercepted it is known only after every listener ran.
 * A page starts its navigations from script, so the event is dispatched on
 * that script's stack and a microtask reads the outcome as soon as dispatch
 * has ended, while the old document is still there to capture. A
 * cross-document traversal cannot be intercepted, so for one the listeners'
 * order does not matter.
 */
export function watchFullLoads(
  view: Window,
  onLoad: (url: string) => void
): void {
  const navigation = view.navigation;
  if (!navigation) return;
  navigation.addEventListener("navigate", (event) => {
    if (event.destination.sameDocument || event.downloadRequest !== null)
      return;
    queueMicrotask(() => {
      // An intercepted navigation is in transition until its handlers end.
      if (navigation.transition === null && !event.defaultPrevented)
        onLoad(event.destination.url);
    });
  });
}
