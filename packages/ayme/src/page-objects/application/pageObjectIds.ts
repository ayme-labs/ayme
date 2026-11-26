import { pageObjectIdOf, type PageObjectId } from "../domain/pageObjectId";
import type { PageDriver } from "./pageDriver";

/** A Page Object Root as a read names it: its class, and its element's Structural Ref. */
export type PageObjectRoot = { className: string; ref: string };

/**
 * Where a Host's Page Object ids come from: each `next()` is an id it never
 * gave before. A Host that shares one across its pages gives no id twice
 * among them.
 */
export type PageObjectIdSource = { next(): PageObjectId };

/** A source that numbers its ids from `po1`. */
export function createPageObjectIdSource(): PageObjectIdSource {
  let given = 0;
  return { next: () => pageObjectIdOf(++given) };
}

/**
 * Package-internal: the Page Object ids of one page. An id belongs to one
 * Page Object: a class on the element of its root. It is given when that
 * Page Object is first read, in the order the Page Objects are read, kept
 * while the element stays on the page, however often captures rename it,
 * and never given to another Page Object. Two classes rooted at one element
 * are two Page Objects, each with its own id; two instances of one class
 * rooted at one element are one. The ids come from `source`, the page's
 * own unless its Host gives one.
 */
export function createPageObjectIds(
  driver: Pick<PageDriver, "elementKeys" | "keyedRefs">,
  source: PageObjectIdSource = createPageObjectIdSource()
) {
  // Each id given: its class and the key of its root's element.
  const roots = new Map<PageObjectId, { className: string; key: string }>();
  const keyOf = (className: string, key: string) => `${className}\u0000${key}`;
  // One read at a time: two reads that both found a root unread would each
  // give it an id.
  let last: Promise<unknown> = Promise.resolve();
  function inTurn<T>(read: () => Promise<T>): Promise<T> {
    const ran = last.then(read);
    last = ran.catch(() => {});
    return ran;
  }

  /**
   * The Structural Ref each root still on the page has now, by id. An id
   * whose element left is forgotten, so its root is never read again.
   */
  async function current(): Promise<Map<PageObjectId, string>> {
    const known = [...roots];
    const now = await driver.keyedRefs(known.map(([, { key }]) => key));
    const refs = new Map<PageObjectId, string>();
    known.forEach(([id], index) => {
      const ref = now[index];
      if (ref) refs.set(id, ref);
      else roots.delete(id);
    });
    return refs;
  }

  return {
    /**
     * Each Page Object `asked` names by its class and the Structural Ref of
     * its root, in the order given, as its id and the ref its root's
     * element has now: a Page Object read for the first time gets the next
     * id, and one whose element is not on the page is undefined.
     */
    rootsOf(
      asked: readonly PageObjectRoot[]
    ): Promise<({ id: PageObjectId; ref: string } | undefined)[]> {
      return inTurn(async () => {
        await current();
        const byKey = new Map(
          [...roots].map(([id, root]) => [keyOf(root.className, root.key), id])
        );
        const now = await driver.elementKeys(asked.map(({ ref }) => ref));
        return now.map((root, index) => {
          if (!root) return undefined;
          const { className } = asked[index]!;
          let id = byKey.get(keyOf(className, root.key));
          if (!id) {
            id = source.next();
            roots.set(id, { className, key: root.key });
            byKey.set(keyOf(className, root.key), id);
          }
          return { id, ref: root.ref };
        });
      });
    },
    /**
     * The class of `id`'s Page Object and the Structural Ref its root's
     * element has now; undefined once it left the page, or for an id never
     * given.
     */
    rootOf(id: string): Promise<PageObjectRoot | undefined> {
      return inTurn(async () => {
        const root = roots.get(id as PageObjectId);
        if (!root) return undefined;
        const ref = (await current()).get(id as PageObjectId);
        return ref === undefined
          ? undefined
          : { className: root.className, ref };
      });
    },
  };
}

export type PageObjectIds = ReturnType<typeof createPageObjectIds>;
