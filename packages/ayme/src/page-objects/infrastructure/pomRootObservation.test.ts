// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolved } = vi.hoisted(() => ({
  resolved: new WeakMap<object, () => Element[]>(),
}));
vi.mock("@ayme-dev/playwright-lite/internal", () => ({
  resolveLocatorElements: (locator: object) => resolved.get(locator)?.() ?? [],
}));
// The in-page module names what is in the way by ref; a jsdom test stands in
// its ref world with the element ids.
vi.mock("../../in-page", () => ({
  elementOfRef: (ref: string) => document.getElementById(ref) ?? undefined,
}));

import type { Locator } from "@playwright/test";
import type { ReachMeasurement } from "../../page-state/application";
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

  it("names the elements the measurement names by ref as in the way, nearest first", async () => {
    const reach = measuringRoots({
      present: true,
      available: false,
      hit: ["pane", "overlay"],
    });

    expect(await observe("root", reach)).toEqual({
      element: byId("root"),
      present: true,
      available: false,
      inTheWay: [byId("pane"), byId("overlay")],
    });
  });

  it("names what blocks every click, the open modal or inert ancestor, by itself only", async () => {
    const reach = measuringRoots({
      present: true,
      available: false,
      blocker: "modal",
    });

    expect((await observe("root", reach)).inTheWay).toEqual([byId("modal")]);
  });

  it("leaves out a ref whose element has left the page", async () => {
    const reach = measuringRoots({
      present: true,
      available: false,
      hit: ["gone", "overlay"],
    });

    expect((await observe("root", reach)).inTheWay).toEqual([byId("overlay")]);
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
