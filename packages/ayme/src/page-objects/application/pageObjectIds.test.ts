import { describe, expect, it } from "vitest";
import { createPageObjectIds } from "./pageObjectIds";

/**
 * A page whose elements are named by the refs in `names`: an element keeps
 * its entry while it is on the page, and a capture may rename it.
 */
function page(...refs: string[]) {
  const names = new Map(refs.map((ref) => [ref, ref]));
  return {
    driver: {
      currentRefs: async (asked: readonly string[]) =>
        asked.map((ref) => names.get(ref)),
    },
    /** A capture marks the element `from` named, which `to` names from now on. */
    rename(from: string, to: string) {
      names.delete(from);
      names.set(from, to);
      names.set(to, to);
    },
    add: (ref: string) => names.set(ref, ref),
    remove(ref: string) {
      for (const [name, current] of [...names])
        if (current === ref) names.delete(name);
    },
  };
}

/** The ids of the roots `refs` name, as the store gives them. */
async function idsOf(
  ids: ReturnType<typeof createPageObjectIds>,
  refs: string[]
) {
  return (await ids.rootsOf(refs)).map((root) => root?.id);
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

    expect(await ids.rootsOf(["e7"])).toEqual([{ id: "po1", ref: "e7" }]);
    expect(await idsOf(ids, ["s_1"])).toEqual(["po1"]);
    expect(await ids.rootOf("po1")).toBe("e7");
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

    expect(await ids.rootOf("po2")).toBe("e2");
    remove("e2");
    expect(await ids.rootOf("po2")).toBeUndefined();
    expect(await ids.rootOf("po1")).toBe("e1");
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

  it("gives a root one id when two reads ask for it at once", async () => {
    const { driver } = page("e1");
    const ids = createPageObjectIds(driver);

    const reads = await Promise.all([idsOf(ids, ["e1"]), idsOf(ids, ["e1"])]);

    expect(reads).toEqual([["po1"], ["po1"]]);
    expect(await idsOf(ids, ["e1"])).toEqual(["po1"]);
  });
});
