// Stryker disable all
// An element filter in the document: a selector matches as the capture runs;
// a Locator's matches are the elements its host handed the module before the
// capture, kept per host under the filter's key. Self-contained, like the
// rest of the page part: the install function closes over nothing.
import type { FilterData } from "../../shared";

type HostKey = string;

/** The elements one host's Locators matched, by the key each was handed under. */
export type Matched = (
  key: string
) => { has(element: Element): boolean } | undefined;

/**
 * Whether `data` keeps an element: a selector when the element matches it, a
 * key when the element is one of the matches `matched` holds under it. A key
 * no matches were handed under keeps nothing.
 */
export function filterOf(
  data: FilterData,
  matched?: Matched
): (element: Element) => boolean {
  if ("selector" in data) return (element) => element.matches(data.selector);
  const elements = matched?.(data.matches);
  return (element) => elements?.has(element) === true;
}

/**
 * Each host's Locator matches, by key: the latest elements a host handed
 * under a key replace those before, until the host forgets the key. Held
 * weakly, so an element the page lets go of is not kept for a host that
 * stopped capturing.
 */
export function createMatches() {
  const byHost = new Map<HostKey, Map<string, WeakSet<Element>>>();
  return {
    /** Keeps `elements` as `host`'s matches of `key`, in place of the ones before. */
    keep(host: HostKey, key: string, elements: readonly Element[]): void {
      let keys = byHost.get(host);
      if (!keys) byHost.set(host, (keys = new Map()));
      keys.set(key, new WeakSet(elements));
    },
    /** Drops `host`'s matches of `keys`, and the host with them once it has none left. */
    forget(host: HostKey, keys: readonly string[]): void {
      const kept = byHost.get(host);
      if (!kept) return;
      for (const key of keys) kept.delete(key);
      if (kept.size === 0) byHost.delete(host);
    },
    /** What `host`'s captures read its matches through. */
    of(host: HostKey): Matched {
      return (key) => byHost.get(host)?.get(key);
    },
  };
}
