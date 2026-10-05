/**
 * Waits `ms` on the window's timer while the document is visible, and ends
 * at once when it is hidden or becomes hidden. A hidden tab stretches the
 * window's timers to about a second, and nobody is watching it then.
 */
export function delayWhileVisible(
  ms: number,
  document: Document = globalThis.document
): Promise<void> {
  if (document.visibilityState === "hidden") return Promise.resolve();
  return new Promise((resolve) => {
    const end = () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onChange);
      resolve();
    };
    const onChange = () => {
      if (document.visibilityState === "hidden") end();
    };
    const timer = setTimeout(end, ms);
    document.addEventListener("visibilitychange", onChange);
  });
}
