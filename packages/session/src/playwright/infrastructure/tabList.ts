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

/** How a read of the listed tabs' pages waits for Playwright. */
export type Handover = {
  /** Waits a moment before the pages are read again. */
  readonly pause: () => Promise<void>;
  /** Whether the wait is over. */
  readonly over: () => boolean;
  /** The tabs not handed over in an earlier wait, which no read waits for
   * again. */
  readonly skipped: Set<string>;
};

/**
 * The pages of the tabs `order` lists, in its order. `pages` reads the
 * pages Playwright has handed over, by tab id, which it does a moment after
 * a tab opens: it is read again until each listed tab is among them or the
 * wait is over. A tab still missing then is left out.
 */
export async function handedOver<Page>(
  order: readonly string[],
  pages: () => Promise<ReadonlyMap<string, Page>>,
  { pause, over, skipped }: Handover
): Promise<Page[]> {
  const missing = (handed: ReadonlyMap<string, Page>) =>
    order.filter((id) => !handed.has(id) && !skipped.has(id));
  let handed = await pages();
  while (missing(handed).length > 0 && !over()) {
    await pause();
    handed = await pages();
  }
  for (const id of skipped) if (!order.includes(id)) skipped.delete(id);
  for (const id of missing(handed)) skipped.add(id);
  return order.flatMap((id) => {
    const page = handed.get(id);
    return page === undefined ? [] : [page];
  });
}
