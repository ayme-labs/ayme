// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolved } = vi.hoisted(() => ({
  resolved: new WeakMap<object, () => Element[]>(),
}));
vi.mock("@ayme-dev/playwright-lite/internal", () => ({
  resolveLocatorElements: (locator: object) => resolved.get(locator)?.() ?? [],
}));

import type { Locator } from "@playwright/test";
import type { ReachMeasurement } from "../../page-state";
import { alwaysReaches } from "../../test-utils/reach.testSupport";
import { observePomRoot } from "./pomRootObservation";

// Unit tests: what one observation of a Page Object Root names as in the
// way, and the one element it observes throughout, given a Reach adapter
// that measures the root as the test says; Chromium covers the geometry.

const byId = (id: string) => document.getElementById(id)!;

function locator(elements: () => Element[]) {
  const fake = { count: async () => elements().length };
  resolved.set(fake, elements);
  return fake as unknown as Locator;
}

/** A Reach adapter that measures every root as `measurement`. */
const measuringRoots = (measurement: ReachMeasurement) =>
  alwaysReaches({ measurePomRoot: async () => measurement });

const observe = async (id: string, reach = alwaysReaches()) =>
  (
    await observePomRoot(
      locator(() => [byId(id)]),
      reach
    )
  ).root;

describe("what a Page Object Root observation names as in the way", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="holder"><section id="root">Root</section><div id="cover"></div></div>
      <div id="overlay"><div id="pane"></div></div>
      <div id="shell"><dialog id="modal"></dialog></div>
    `;
  });

  it("names nothing for a root a click would reach", async () => {
    expect(await observe("root")).toEqual({
      element: byId("root"),
      present: true,
      available: true,
      inTheWay: [],
    });
  });

  it("names the element hit and its ancestors up to the first that holds the root", async () => {
    const reach = measuringRoots({
      present: true,
      available: false,
      hit: byId("pane"),
    });

    expect(await observe("root", reach)).toEqual({
      element: byId("root"),
      present: true,
      available: false,
      inTheWay: [byId("pane"), byId("overlay")],
    });
  });

  it("names a hit element that holds the root by itself only", async () => {
    const reach = measuringRoots({
      present: true,
      available: false,
      hit: byId("holder"),
    });

    expect((await observe("root", reach)).inTheWay).toEqual([byId("holder")]);
  });

  it("names only the hit when its parent holds the root", async () => {
    const reach = measuringRoots({
      present: true,
      available: false,
      hit: byId("cover"),
    });

    expect((await observe("root", reach)).inTheWay).toEqual([byId("cover")]);
  });

  it("names what blocks every click, the open modal or inert ancestor, by itself only", async () => {
    const reach = measuringRoots({
      present: true,
      available: false,
      blocker: byId("modal"),
    });

    expect((await observe("root", reach)).inTheWay).toEqual([byId("modal")]);
  });

  it("observes nothing unless the locator is one element throughout", async () => {
    const absent = {
      element: undefined,
      present: false,
      available: false,
      inTheWay: [],
    };
    const root = byId("root");
    const cover = byId("cover");
    const reach = alwaysReaches();

    await expect(
      observePomRoot(
        locator(() => []),
        reach
      )
    ).resolves.toEqual({
      count: 0,
      root: absent,
    });
    await expect(
      observePomRoot(
        locator(() => [root, cover]),
        reach
      )
    ).resolves.toEqual({ count: 2, root: absent });
    // Kept while the layout does not show it, so the page state can tell an
    // absent root apart.
    const hidden = measuringRoots({ present: false, available: false });
    await expect(
      observePomRoot(
        locator(() => [root]),
        hidden
      )
    ).resolves.toEqual({
      count: 1,
      root: { ...absent, element: root },
    });

    let calls = 0;
    const replaced = locator(() => [calls++ < 2 ? root : cover]);
    await expect(observePomRoot(replaced, reach)).resolves.toEqual({
      count: 1,
      root: absent,
    });
  });
});
