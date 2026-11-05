// The Navigation API: when a navigation a Browser Tool calls for starts.
// The document's in-page module watches the navigations themselves.

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
