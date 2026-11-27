import { describe, expect, it } from "vitest";
import { createPageObjectIds, createPageObjectIdSource } from "./pageObjectIds";

/**
 * A page whose elements are named by the refs in `names`, each element by
 * the key it was first named by: an element keeps its key while it is on
 * the page, and a capture may rename it.
 */
function page(...refs: string[]) {
  // The element each ref names, by the element's key.
  const names = new Map(refs.map((ref) => [ref, ref]));
  // The ref each element, by key, has now.
  const current = new Map(refs.map((ref) => [ref, ref]));
  return {
    driver: {
      elementKeys: async (asked: readonly string[]) =>
        asked.map((ref) => {
          const key = names.get(ref);
          return key === undefined
            ? undefined
            : { key, ref: current.get(key)! };
        }),
      keyedRefs: async (keys: readonly string[]) =>
        keys.map((key) => current.get(key)),
    },
    /**
     * A capture names the element `from` named by `to` from now on; the refs
     * it had before name it no longer, as an element renamed often forgets
     * its oldest refs.
     */
    rename(from: string, to: string) {
      const key = names.get(from)!;
      for (const [ref, named] of [...names])
        if (named === key) names.delete(ref);
      names.set(to, key);
      current.set(key, to);
    },
    add(ref: string) {
      const key = `${ref}#${names.size}`;
      names.set(ref, key);
      current.set(key, ref);
    },
    remove(ref: string) {
      const key = names.get(ref)!;
      for (const [name, named] of [...names])
        if (named === key) names.delete(name);
      current.delete(key);
    },
  };
}

/** The roots of class `A` that `refs` name. */
const rootsAt = (...refs: string[]) =>
  refs.map((ref) => ({ className: "A", ref }));

/** The ids of the `A`s rooted at `refs`, as the store gives them. */
async function idsOf(
  ids: ReturnType<typeof createPageObjectIds>,
  refs: string[]
) {
  return (await ids.rootsOf(rootsAt(...refs))).map((root) => root?.id);
}

describe("Page Object ids", () => {
  it("numbers the roots in the order they are first read", async () => {
    const { driver } = page("e1", "e2", "e3");
    const ids = createPageObjectIds(driver);

    expect(await idsOf(ids, ["e2", "e1"])).toEqual(["po1", "po2"]);
    expect(await idsOf(ids, ["e1", "e3", "e2"])).toEqual(["po2", "po3", "po1"]);
  });

  it("keeps a root's id when a capture gives its element another ref", async () => {
    const { driver, rename } = page("s_1");
    const ids = createPageObjectIds(driver);
    expect(await idsOf(ids, ["s_1"])).toEqual(["po1"]);

    rename("s_1", "e7");

    expect(await ids.rootsOf(rootsAt("e7"))).toEqual([
      { id: "po1", ref: "e7" },
    ]);
    expect(await ids.rootOf("po1")).toEqual({ className: "A", ref: "e7" });
  });

  it("keeps a root's id however often its element is renamed between two reads, though its earlier refs name it no longer", async () => {
    const { driver, rename } = page("e1");
    const ids = createPageObjectIds(driver);
    expect(await idsOf(ids, ["e1"])).toEqual(["po1"]);

    for (let at = 2; at <= 20; at += 1) rename(`e${at - 1}`, `e${at}`);

    expect(await ids.rootOf("po1")).toEqual({ className: "A", ref: "e20" });
    expect(await ids.rootsOf(rootsAt("e20"))).toEqual([
      { id: "po1", ref: "e20" },
    ]);
  });

  it("gives a root that is not on the page no id", async () => {
    const { driver } = page("e1");
    const ids = createPageObjectIds(driver);

    expect(await idsOf(ids, ["e9", "e1"])).toEqual([undefined, "po1"]);
  });

  it("names the root an id belongs to while its element stays on the page", async () => {
    const { driver, remove } = page("e1", "e2");
    const ids = createPageObjectIds(driver);
    await idsOf(ids, ["e1", "e2"]);

    expect(await ids.rootOf("po2")).toEqual({ className: "A", ref: "e2" });
    remove("e2");
    expect(await ids.rootOf("po2")).toBeUndefined();
    expect(await ids.rootOf("po1")).toEqual({ className: "A", ref: "e1" });
  });

  it("names no root for an id it never gave", async () => {
    const { driver } = page("e1");
    const ids = createPageObjectIds(driver);

    expect(await ids.rootOf("po1")).toBeUndefined();
  });

  it("never gives the id of a root that left to another root", async () => {
    const { driver, remove, add } = page("e1", "e2");
    const ids = createPageObjectIds(driver);
    await idsOf(ids, ["e1", "e2"]);

    remove("e1");
    add("e3");

    expect(await idsOf(ids, ["e3", "e2"])).toEqual(["po3", "po2"]);
    // Not even to an element that takes the ref of the one that left.
    add("e1");
    expect(await idsOf(ids, ["e1"])).toEqual(["po4"]);
    expect(await ids.rootOf("po1")).toBeUndefined();
  });

  it("gives each class rooted at one element an id of its own", async () => {
    const { driver } = page("e1");
    const ids = createPageObjectIds(driver);

    const roots = await ids.rootsOf([
      { className: "A", ref: "e1" },
      { className: "B", ref: "e1" },
    ]);

    expect(roots).toEqual([
      { id: "po1", ref: "e1" },
      { id: "po2", ref: "e1" },
    ]);
    expect(await ids.rootOf("po2")).toEqual({ className: "B", ref: "e1" });
    expect(await idsOf(ids, ["e1"])).toEqual(["po1"]);
  });

  it("gives a root one id when two reads ask for it at once", async () => {
    const { driver } = page("e1");
    const ids = createPageObjectIds(driver);

    const reads = await Promise.all([idsOf(ids, ["e1"]), idsOf(ids, ["e1"])]);

    expect(reads).toEqual([["po1"], ["po1"]]);
    expect(await idsOf(ids, ["e1"])).toEqual(["po1"]);
  });
});

describe("Page Object ids from a source a Host gives", () => {
  it("never gives one id on two pages that share the source", async () => {
    const source = createPageObjectIdSource();
    const first = createPageObjectIds(page("e1", "e2").driver, source);
    const second = createPageObjectIds(page("e1", "e2").driver, source);

    expect(await idsOf(first, ["e1"])).toEqual(["po1"]);
    expect(await idsOf(second, ["e1", "e2"])).toEqual(["po2", "po3"]);
    expect(await idsOf(first, ["e2", "e1"])).toEqual(["po4", "po1"]);
    expect(await first.rootOf("po2")).toBeUndefined();
    expect(await second.rootOf("po2")).toEqual({ className: "A", ref: "e1" });
  });

  it("keeps an id while its element stays, never gives it to another Page Object, and gives two classes on one element two ids", async () => {
    const source = createPageObjectIdSource();
    const shown = page("e1");
    const first = createPageObjectIds(shown.driver, source);
    const second = createPageObjectIds(page("e1").driver, source);

    expect(
      await first.rootsOf([
        { className: "A", ref: "e1" },
        { className: "B", ref: "e1" },
      ])
    ).toEqual([
      { id: "po1", ref: "e1" },
      { id: "po2", ref: "e1" },
    ]);
    expect(await idsOf(second, ["e1"])).toEqual(["po3"]);

    shown.rename("e1", "e5");
    expect(await first.rootOf("po1")).toEqual({ className: "A", ref: "e5" });
    expect(await idsOf(first, ["e5"])).toEqual(["po1"]);

    shown.remove("e5");
    shown.add("e1");
    expect(await idsOf(first, ["e1"])).toEqual(["po4"]);
    expect(await first.rootOf("po1")).toBeUndefined();
    expect(await idsOf(second, ["e1"])).toEqual(["po3"]);
  });

  it("tells its source each id it forgets, once a read finds its element gone, and no other", async () => {
    const released: string[] = [];
    const numbered = createPageObjectIdSource();
    const source = {
      next: () => numbered.next(),
      released: (id: string) => released.push(id),
    };
    const shown = page("e1", "e2");
    const ids = createPageObjectIds(shown.driver, source);
    expect(await idsOf(ids, ["e1", "e2"])).toEqual(["po1", "po2"]);

    shown.remove("e1");
    shown.rename("e2", "e5");
    expect(released).toEqual([]);
    expect(await idsOf(ids, ["e5"])).toEqual(["po2"]);

    expect(released).toEqual(["po1"]);
  });

  it("tells its source the class of each Page Object it gives an id", async () => {
    const asked: string[] = [];
    const numbered = createPageObjectIdSource();
    const source = {
      next: (className: string) => {
        asked.push(className);
        return numbered.next(className);
      },
    };
    const ids = createPageObjectIds(page("e1").driver, source);

    await ids.rootsOf([
      { className: "A", ref: "e1" },
      { className: "B", ref: "e1" },
    ]);

    expect(asked).toEqual(["A", "B"]);
  });
});
