import type { ClientBehaviour } from "../application/behaviours";

/**
 * Tells the server when the page starts loading a new document, so it can
 * say where the page went if the page's calls stay unanswered. It watches
 * the Navigation API's `navigate` event; a navigation that stays in the
 * document is ignored: a fragment change, a same-document traversal, one a
 * listener intercepted, such as a router, or cancelled, and a download.
 * Without the Navigation API it reports nothing.
 */
export const reportLeaving: ClientBehaviour = ({ channel }) => {
  const { navigation } = window;
  if (!navigation) return () => {};
  const watching = new AbortController();
  navigation.addEventListener(
    "navigate",
    (event) => {
      if (event.destination.sameDocument || event.downloadRequest !== null)
        return;
      // Whether a listener intercepted it is known once every listener ran;
      // an intercepted navigation is in transition until its handlers end.
      queueMicrotask(() => {
        if (watching.signal.aborted) return;
        if (navigation.transition !== null || event.defaultPrevented) return;
        void channel
          .reportLeaving({
            url: event.destination.url,
            reload: event.navigationType === "reload",
          })
          // The channel closed first; the server then reports a closed tab.
          .catch(() => {});
      });
    },
    { signal: watching.signal }
  );
  return () => watching.abort();
};
