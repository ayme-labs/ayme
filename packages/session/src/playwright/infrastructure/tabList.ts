/** Where a browser at `address`, the one a Session opened or joined, lists
 * its tabs over HTTP: the same host, for an address of either protocol. */
export function tabListAddress(address: string): string {
  const url = new URL(address);
  const secure = url.protocol === "https:" || url.protocol === "wss:";
  return `${secure ? "https" : "http"}://${url.host}/json/list`;
}

/** Why an answer is no tab list, as a read of one refuses it. */
class NoTabList extends Error {}

const isTarget = (entry: unknown): entry is { type: string; id?: unknown } =>
  typeof (entry as { type?: unknown } | null)?.type === "string";

/**
 * The ids of the browser's tabs in the order its tab list `list` gives
 * them: Chromium puts the most recently active first, while its tabs share
 * one window. Workers, frames and other targets are no tabs.
 */
export function pageTargets(list: unknown): string[] {
  if (!Array.isArray(list)) throw new NoTabList("no list");
  if (!list.every(isTarget)) throw new NoTabList("an entry that is no target");
  const pages = list.filter(({ type }) => type === "page");
  if (!pages.every(({ id }) => typeof id === "string"))
    throw new NoTabList("a page without an id");
  return pages.map(({ id }) => id as string);
}

/**
 * The ids of the browser's tabs, the most recently active first, as its tab
 * list at `list` answers within `deadline` milliseconds. It stops when
 * `signal` aborts, as when the Session ends.
 */
export async function readTabOrder(
  list: string,
  { signal, deadline }: { signal: AbortSignal; deadline: number }
): Promise<string[]> {
  const timeout = AbortSignal.timeout(deadline);
  try {
    const answer = await fetch(list, {
      signal: AbortSignal.any([signal, timeout]),
    });
    if (!answer.ok)
      throw new Error(`${list} answered with HTTP status ${answer.status}.`);
    return pageTargets(await answer.json());
  } catch (error) {
    if (timeout.aborted)
      throw new Error(
        `${list} did not answer within ${deadline / 1000} seconds.`,
        { cause: error }
      );
    if (error instanceof NoTabList)
      throw new Error(
        `${list} answered something other than the browser's tab list: ${error.message}.`,
        { cause: error }
      );
    throw error;
  }
}

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
