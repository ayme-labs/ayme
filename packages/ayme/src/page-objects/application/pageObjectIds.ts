import { pageObjectIdOf, type PageObjectId } from "../domain/pageObjectId";
import type { PageDriver } from "./pageDriver";

/**
 * Package-internal: the Page Object ids of one page. An id belongs to the
 * element of a Page Object Root: it is given when the root is first read,
 * in the order the roots are read, kept while that element stays on the
 * page, however often captures rename it, and never given to another root.
 */
export function createPageObjectIds(
  driver: Pick<PageDriver, "elementKeys" | "keyedRefs">
) {
  // Each id given and the key of its root's element.
  const roots = new Map<PageObjectId, string>();
  let given = 0;
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
    const now = await driver.keyedRefs(known.map(([, key]) => key));
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
     * Each Page Object Root `rootRefs` name by Structural Ref, in the order
     * given, as its id and the ref its element has now: a root read for the
     * first time gets the next id, and one whose element is not on the page
     * is undefined.
     */
    rootsOf(
      rootRefs: readonly string[]
    ): Promise<({ id: PageObjectId; ref: string } | undefined)[]> {
      return inTurn(async () => {
        await current();
        const byKey = new Map([...roots].map(([id, key]) => [key, id]));
        const now = await driver.elementKeys(rootRefs);
        return now.map((root) => {
          if (!root) return undefined;
          let id = byKey.get(root.key);
          if (!id) {
            id = pageObjectIdOf(++given);
            roots.set(id, root.key);
            byKey.set(root.key, id);
          }
          return { id, ref: root.ref };
        });
      });
    },
    /**
     * The Structural Ref the element of `id`'s root has now; undefined once
     * it left the page, or for an id never given.
     */
    rootOf(id: string): Promise<string | undefined> {
      return inTurn(async () => {
        if (!roots.has(id as PageObjectId)) return undefined;
        return (await current()).get(id as PageObjectId);
      });
    },
  };
}

export type PageObjectIds = ReturnType<typeof createPageObjectIds>;
