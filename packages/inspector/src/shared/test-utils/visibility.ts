/**
 * Shows the document as hidden, as a tab behind another one is, and
 * dispatches `visibilitychange`; returns what shows it as it was.
 */
export function hideDocument(document: Document = globalThis.document) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "hidden",
  });
  document.dispatchEvent(new Event("visibilitychange"));
  return () => {
    Reflect.deleteProperty(document, "visibilityState");
    document.dispatchEvent(new Event("visibilitychange"));
  };
}
