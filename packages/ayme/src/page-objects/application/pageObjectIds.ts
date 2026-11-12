import { pageObjectIdOf, type PageObjectId } from "../domain/pageObjectId";
import type { PageDriver } from "./pageDriver";

/**
 * Package-internal: the Page Object ids of one page. An id belongs to the
 * element of a Page Object Root: it is given when the root is first read,
 * in the order the roots are read, kept while that element stays on the
 * page, and never given to another root.
 */
export function createPageObjectIds(driver: Pick<PageDriver, "currentRefs">) {
  // Each id given and the Structural Ref its root's element had when last read.
  const roots = new Map<PageObjectId, string>();
  let given = 0;

  /** The id of each root still on the page, by the ref its element has now. */
  async function current(): Promise<Map<string, PageObjectId>> {
    const known = [...roots];
    const now = await driver.currentRefs(known.map(([, ref]) => ref));
    known.forEach(([id], index) => {
      const ref = now[index];
      if (ref) roots.set(id, ref);
      else roots.delete(id);
    });
    return new Map([...roots].map(([id, ref]) => [ref, id]));
  }

  return {
    /**
     * Each Page Object Root `rootRefs` name by Structural Ref, in the order
     * given, as its id and the ref its element has now: a root read for the
     * first time gets the next id, and one whose element is not on the page
     * is undefined.
     */
    async rootsOf(
      rootRefs: readonly string[]
    ): Promise<({ id: PageObjectId; ref: string } | undefined)[]> {
      const byRoot = await current();
      const now = await driver.currentRefs(rootRefs);
      return now.map((ref) => {
        if (!ref) return undefined;
        let id = byRoot.get(ref);
        if (!id) {
          id = pageObjectIdOf(++given);
          roots.set(id, ref);
          byRoot.set(ref, id);
        }
        return { id, ref };
      });
    },
    /**
     * The Structural Ref the element of `id`'s root has now; undefined once
     * it left the page, or for an id never given.
     */
    async rootOf(id: string): Promise<string | undefined> {
      if (!roots.has(id as PageObjectId)) return undefined;
      await current();
      return roots.get(id as PageObjectId);
    },
  };
}

export type PageObjectIds = ReturnType<typeof createPageObjectIds>;
