// Stryker disable all
// The document's element keys: what names a Page Object Root's element for
// the Page Object id store, whatever refs captures give it.

/**
 * The keys of one document's elements, each `<document>:<n>`: a key names
 * its element for as long as the element lives, however often captures
 * rename it, and never an element of another document. A key is no ref:
 * no capture prints it and nothing acts on it.
 */
export function createElementKeys(document: string) {
  const keys = new WeakMap<Element, string>();
  const byKey = new Map<string, WeakRef<Element>>();
  let last = 0;
  return {
    /** The key of `element`, minted the first time it is asked for. */
    keyOf(element: Element): string {
      let key = keys.get(element);
      if (key === undefined) {
        // The keys of elements the page let go of go with them.
        for (const [old, held] of byKey)
          if (held.deref() === undefined) byKey.delete(old);
        key = `${document}:${++last}`;
        keys.set(element, key);
        byKey.set(key, new WeakRef(element));
      }
      return key;
    },
    /** The element `key` names, while it lives. */
    elementOf: (key: string): Element | undefined => byKey.get(key)?.deref(),
  };
}
