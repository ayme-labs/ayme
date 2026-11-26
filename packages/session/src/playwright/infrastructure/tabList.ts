/** Where a browser at `address`, the one a Session opened or joined, lists
 * its tabs over HTTP: the same host, for an address of either protocol. */
export function tabListAddress(address: string): string {
  const url = new URL(address);
  const secure = url.protocol === "https:" || url.protocol === "wss:";
  return `${secure ? "https" : "http"}://${url.host}/json/list`;
}

/** A target as the browser's tab list gives it. */
type Target = { readonly id: string; readonly type: string };

/**
 * The ids of the browser's tabs in the order its tab list gives them:
 * Chromium puts the most recently active first, while its tabs share one
 * window. Workers, frames and other targets are no tabs.
 */
export const pageTargets = (list: readonly Target[]): string[] =>
  list.filter(({ type }) => type === "page").map(({ id }) => id);
