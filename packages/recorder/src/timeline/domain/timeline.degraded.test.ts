import { readFileSync } from "node:fs";
import {
  StructuralTree,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SnapshotId, TimelineAddition } from "./recorded";
import { pictureRef } from "./refs";
import type { PackageHeader, Timeline } from "./timeline";
import {
  changeTreesOf,
  header,
  page,
  snapshot,
  timelineOf,
  visit,
} from "../../../testing/timeline/timelineBuilders";
import {
  entryId,
  pageId,
  snapshotId,
  tracePositions,
} from "../../../testing/ids";

// A recording goes on when a read of the page cannot be kept or a step's
// changes cannot be worked out: the step stays, with as much as can be told
// of it, and a warning names it.

/** A click on the "Add" button, held by the gate between two reads. */
const click = (
  before: SnapshotId,
  after: SnapshotId,
  at: number
): TimelineAddition => ({
  kind: "interaction",
  interaction: {
    page: pageId("page_1"),
    report: {
      type: "click",
      selector: 'internal:role=button[name="Add"i]',
      target: { ref: pictureRef("e2"), tree: counter(0) },
      values: { button: "left" },
    },
    before,
    after,
    at,
  },
});

/** A page with a button and how often it was clicked. */
const counter = (count: number) =>
  page(`- button "Add" [ref=e2]`, `- paragraph [ref=e3]: Count ${count}`);

/** A read core's parser refuses: its first line lacks the leading "- ". */
const unreadable = `generic [ref=e1]:\n  - button "Add" [ref=e2]`;

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/** The three clicks of the cart fixture, the second of which makes the page
 * re-create "Add item": Playwright names it e7 from then on, and the
 * package keeps e5. */
const cart = () =>
  JSON.parse(fixture("cart-flow.recording.json")) as {
    header: PackageHeader;
    additions: TimelineAddition[];
  };

/** The cart fixture's package, each Interaction's entry as `entry` writes
 * it: `nth` counts them from 1. */
const cartPackage = (entry: (released: string, nth: number) => string) => {
  const mark = "      - kind: interaction\n";
  const [head, ...entries] = fixture("cart-flow.package.txt").split(mark);
  const [last, tail] = entries.pop()!.split("traceActionPoints:");
  const written = [...entries, last!].map((one, index) =>
    entry(one, index + 1)
  );
  return `${[head, ...written].join(mark)}traceActionPoints:${tail}`;
};

const withoutChangeTree = (entry: string) =>
  entry.split("        changeTree:")[0]!;

/** The cart fixture, replayed up to its second click; `rest` are the
 * second click and all after it. */
async function cartBeforeItsSecondClick() {
  const { header, additions } = cart();
  return {
    header,
    timeline: await timelineOf(additions.slice(0, 6)),
    rest: additions.slice(6),
  };
}

const notWorkedOut = (id: string) =>
  `The changes of ${id} could not be worked out, so it has no change list. The trace holds the page before and after it.`;
const notFullyWorkedOut = (id: string) =>
  `The changes of ${id} could not be fully worked out. An element the page re-created may be listed under another ref, or as removed and added.`;
const maybeChangedAfter = (id: string) =>
  `Whether the page changed by itself after ${id} could not be worked out: no such change is listed.`;

/** Whether core marked what changed on the tree's nodes: a read has no
 * marks. */
const isChangeTree = (tree: StructuralTree) =>
  tree.getAllNodes().some((node) => node.status !== undefined);

const s = (number: number) => snapshotId(`snapshot_${number}`);

const messages = (timeline: Timeline) =>
  timeline.warnings().map((warning) => warning.message);

/** The package's text from a Visit's first tree to its entries. */
const baselineOf = (text: string, visitId: string) =>
  text
    .split(`visitId: ${visitId}\n`)[1]!
    .split("    baselineTree:")[1]!
    .split("\n    timelineEntries:")[0]!;

const changed = (...rows: string[]) =>
  [`- [ref=e1]:`, ...rows.map((row) => `  - <changed> ${row}`)].join("\n");

describe("a read of the page that cannot be kept", () => {
  it("is stood in for by the read before it: the step it ends has no Change Tree, and the next step tells what both changed", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, counter(0)),
      snapshot(s(2), 20, unreadable),
      click(s(1), s(2), 15),
      snapshot(s(3), 30, counter(2)),
      click(s(2), s(3), 25),
      snapshot(s(4), 40, counter(3)),
      click(s(3), s(4), 35),
    ]);

    const text = (await timeline.package(header))!;

    expect(changeTreesOf(text)).toEqual([
      { kind: "interaction", changeTree: null },
      {
        kind: "interaction",
        changeTree: changed(`[ref=e3] paragraph: Count 2`),
      },
      {
        kind: "interaction",
        changeTree: changed(`[ref=e3] paragraph: Count 3`),
      },
    ]);
    expect(text).toContain("id: interaction_1");
    expect(timeline.warnings()).toEqual([
      {
        kind: "pageNotRead",
        message:
          "The page could not be read after interaction_1. What it changed is listed with the next step, or as a change without a step.",
      },
      {
        kind: "pageNotRead",
        message:
          "The page could not be read before interaction_2. Its changes can include what the page changed before it.",
      },
    ]);
  });

  it("leaves what the step changed to a change of its own when the next Interaction starts at a later read", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, counter(0)),
      snapshot(s(2), 20, unreadable),
      click(s(1), s(2), 15),
      snapshot(s(3), 30, counter(1)),
      snapshot(s(4), 40, counter(2)),
      click(s(3), s(4), 35),
    ]);

    expect(changeTreesOf((await timeline.package(header))!)).toEqual([
      { kind: "interaction", changeTree: null },
      { kind: "change", changeTree: changed(`[ref=e3] paragraph: Count 1`) },
      {
        kind: "interaction",
        changeTree: changed(`[ref=e3] paragraph: Count 2`),
      },
    ]);
    expect(messages(timeline)).toEqual([
      "The page could not be read after interaction_1. What it changed is listed with the next step, or as a change without a step.",
    ]);
  });

  it("is stood in for by an empty page when it is its Visit's first: the Visit starts empty, and its first step lists the page as added", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, unreadable),
      snapshot(s(2), 20, counter(1)),
      click(s(1), s(2), 15),
    ]);

    const text = (await timeline.package(header))!;

    expect(baselineOf(text, "visit_1")).toBe(" []");
    expect(changeTreesOf(text)).toEqual([
      {
        kind: "interaction",
        changeTree: [
          `- <added> [ref=e1]:`,
          `  - <added> [ref=e2] button "Add"`,
          `  - <added> [ref=e3] paragraph: Count 1`,
        ].join("\n"),
      },
    ]);
    expect(messages(timeline)).toEqual([
      "The page could not be read before interaction_1. Its changes can include what the page changed before it.",
    ]);
  });

  it("is stood in for when one ref names two of its elements, which core's record of the elements refuses", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, counter(0)),
      snapshot(
        s(2),
        20,
        page(`- button "Add" [ref=e2]`, `- paragraph [ref=e2]: Count 1`)
      ),
      click(s(1), s(2), 15),
      snapshot(s(3), 30, counter(2)),
      click(s(2), s(3), 25),
    ]);

    expect(changeTreesOf((await timeline.package(header))!)).toEqual([
      { kind: "interaction", changeTree: null },
      {
        kind: "interaction",
        changeTree: changed(`[ref=e3] paragraph: Count 2`),
      },
    ]);
  });

  it("is stood in for by a read of its own page, never by another page's", async () => {
    const other = pageId("page_2");
    const otherUrl = "http://shop.test/other";
    const read = (id: SnapshotId, at: number, tree: string) => ({
      kind: "snapshot" as const,
      snapshot: { id, page: other, url: otherUrl, at, tree },
    });
    const timeline = await timelineOf([
      visit,
      { kind: "visit", page: other, url: otherUrl, cause: "openPage" },
      read(s(1), 10, counter(7)),
      snapshot(s(2), 20, counter(0)),
      read(s(3), 30, unreadable),
      snapshot(s(4), 40, counter(1)),
      click(s(2), s(4), 35),
      read(s(5), 50, counter(8)),
      {
        kind: "interaction",
        interaction: {
          page: other,
          report: {
            type: "click",
            selector: 'internal:role=button[name="Add"i]',
            target: null,
            values: {},
          },
          before: s(3),
          after: s(5),
          at: 45,
        },
      },
    ]);

    const text = (await timeline.package(header))!;

    expect(baselineOf(text, "visit_2")).toContain("Count 7");
    expect(changeTreesOf(text)).toEqual([
      {
        kind: "interaction",
        changeTree: changed(`[ref=e3] paragraph: Count 1`),
      },
      {
        kind: "interaction",
        changeTree: changed(`[ref=e3] paragraph: Count 8`),
      },
    ]);
    expect(messages(timeline)).toEqual([
      "The page could not be read before interaction_2. Its changes can include what the page changed before it.",
    ]);
  });

  it("keeps its place in the trace, which still holds the page it could not keep", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, counter(0)),
      snapshot(s(2), 20, unreadable),
      click(s(1), s(2), 15),
    ]);

    expect(
      await timeline.package(
        header,
        tracePositions({ snapshot_1: "11", snapshot_2: "17" })
      )
    ).toContain(
      [
        `  - interactionId: interaction_1`,
        `    pageId: page_1`,
        `    beforeSnapshotId: "11"`,
        `    afterSnapshotId: "17"`,
      ].join("\n")
    );
  });

  it("is warned of once when typing goes on past it: the text is the latest, and its changes are those up to the read before", async () => {
    const typed = (text: string) => page(`- textbox "Item" [ref=e2]: ${text}`);
    const typing = (after: SnapshotId, text: string): TimelineAddition => ({
      kind: "interaction",
      key: "fill_1",
      interaction: {
        page: pageId("page_1"),
        report: {
          type: "fill",
          selector: 'internal:role=textbox[name="Item"i]',
          target: {
            ref: pictureRef("e2"),
            tree: page(`- textbox "Item" [ref=e2]`),
          },
          values: { text },
        },
        before: s(1),
        after,
        at: 15,
        beforeFromReport: true,
      },
    });
    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, page(`- textbox "Item" [ref=e2]`)),
      snapshot(s(2), 20, typed("m")),
      typing(s(2), "m"),
      snapshot(s(3), 30, unreadable),
      typing(s(3), "mi"),
      typing(s(3), "mil"),
    ]);

    const text = (await timeline.package(header))!;

    expect(text).toContain("text: mil");
    expect(changeTreesOf(text)).toEqual([
      {
        kind: "interaction",
        changeTree: changed(`[ref=e2] textbox "Item": m`),
      },
    ]);
    expect(messages(timeline)).toEqual([
      "The page could not be read after interaction_1. What it changed is listed with the next step, or as a change without a step.",
    ]);
  });

  it("leaves the other steps as they are with the read kept: an element it was the first to show re-created keeps its first ref in the steps after", async () => {
    const recording = cart();
    // The read after the second click: the first to show "Add item"
    // re-created, under e7. That is all it shows beyond the read before
    // it, and a re-created element is no change: so the package is the
    // released one.
    const timeline = await timelineOf(
      recording.additions.map((addition) =>
        addition.kind === "snapshot" && addition.snapshot.id === s(4)
          ? {
              ...addition,
              snapshot: { ...addition.snapshot, tree: unreadable },
            }
          : addition
      )
    );

    expect(await timeline.package(recording.header)).toBe(
      fixture("cart-flow.package.txt")
    );
    expect(messages(timeline)).toEqual([
      "The page could not be read after interaction_2. What it changed is listed with the next step, or as a change without a step.",
    ]);
  });
});

// The three stages a step's changes are worked out in have no input known
// to break them: the pages that did are fixed. So each is broken here where
// it calls core, as the fixed ones broke.
describe("a step whose changes cannot be worked out", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps its Change Tree when only its rows cannot be named: the package is the same, and whoever shows the recorder lists no change for it", async () => {
    const ancestorsOf = StructuralTree.prototype.getAncestorsOf;
    vi.spyOn(StructuralTree.prototype, "getAncestorsOf").mockImplementation(
      function (this: StructuralTree, ref) {
        if (isChangeTree(this))
          throw new Error("Structural tree contains a parent cycle at e5");
        return ancestorsOf.call(this, ref);
      }
    );
    const { header, additions } = cart();

    const timeline = await timelineOf(additions);

    expect(await timeline.package(header)).toBe(
      fixture("cart-flow.package.txt")
    );
    expect(timeline.visits()[0]!.entries.map((entry) => entry.changes)).toEqual(
      [[], [], []]
    );
    expect(timeline.warnings()).toEqual(
      [1, 2, 3].map((nth) => ({
        kind: "changesNotWorkedOut",
        message: `The changes of interaction_${nth} cannot be listed in the recorder window. The recording package is not affected.`,
      }))
    );
  });

  describe("when its elements cannot be written under their first refs", () => {
    // Core keeps the later ref of an element it matched under two.
    const underOwnRefs = fixture("cart-flow.package.txt").replaceAll(
      `<changed> [ref=e5] button "Add item"`,
      `<changed> [ref=e7] button "Add item"`
    );
    const warned = [1, 2, 3].map((nth) => ({
      kind: "changesNotWorkedOut",
      message: notFullyWorkedOut(`interaction_${nth}`),
    }));

    it("keeps core's Change Tree under the refs the page gave: a re-created element shows under its new ref, and the target under its first", async () => {
      const beforeNode = StructuralTree.prototype.getBeforeNode;
      const failed = new WeakSet<StructuralTree>();
      vi.spyOn(StructuralTree.prototype, "getBeforeNode").mockImplementation(
        function (this: StructuralTree, ref) {
          // Once for each Change Tree: as it is renamed, not as its rows
          // are named after.
          if (isChangeTree(this) && !failed.has(this)) {
            failed.add(this);
            throw new Error("Cannot read properties of undefined");
          }
          return beforeNode.call(this, ref);
        }
      );
      const { header, additions } = cart();

      const timeline = await timelineOf(additions);

      expect(await timeline.package(header)).toBe(underOwnRefs);
      expect(timeline.warnings()).toEqual(warned);
    });

    it("does the same when the renaming leaves one ref on two elements", async () => {
      const duplicateRef = StructuralTree.prototype.findDuplicateRef;
      vi.spyOn(StructuralTree.prototype, "findDuplicateRef").mockImplementation(
        function (this: StructuralTree) {
          return isChangeTree(this)
            ? ("e5" as AriaRef)
            : duplicateRef.call(this);
        }
      );
      const { header, additions } = cart();

      const timeline = await timelineOf(additions);

      expect(await timeline.package(header)).toBe(underOwnRefs);
      expect(timeline.warnings()).toEqual(warned);
    });

    it("still answers where a row's element is now, by the selector of its label", async () => {
      const duplicateRef = StructuralTree.prototype.findDuplicateRef;
      vi.spyOn(StructuralTree.prototype, "findDuplicateRef").mockImplementation(
        function (this: StructuralTree) {
          return isChangeTree(this)
            ? ("e5" as AriaRef)
            : duplicateRef.call(this);
        }
      );

      const timeline = await timelineOf(cart().additions);

      // The second row of the third click: "Add item", under e7.
      expect(timeline.liveTarget(entryId("interaction_3"), 1)).toEqual({
        page: pageId("page_1"),
        find: {
          by: "selector",
          selector: 'internal:role=button[name="Add item"s]',
        },
      });
    });
  });

  /** Makes core's comparison of two trees fail: `always`, or only where it
   * is told which elements are the same by more than their refs. */
  const comparisonFails = (always: boolean) => {
    const reconcile = StructuralTree.reconcile.bind(StructuralTree);
    vi.spyOn(StructuralTree, "reconcile").mockImplementation(
      (before, after, options) => {
        // Told of no identities: core's own record of the elements.
        if (!options) return reconcile(before, after);
        const sameByMore = options.sameIdentity!(
          "e5" as AriaRef,
          "e7" as AriaRef
        );
        if (always || sameByMore) throw new Error("no comparison");
        return reconcile(before, after, options);
      }
    );
  };

  it("is compared again with only an element under the same ref taken for the same one: a re-created element shows as removed and added", async () => {
    const { header, timeline, rest } = await cartBeforeItsSecondClick();
    comparisonFails(false);
    for (const addition of rest) await timeline.add(addition);

    expect(await timeline.package(header)).toBe(
      cartPackage((released, nth) =>
        nth === 2
          ? released.replace(
              `            - <changed> [ref=e5] button "Add item"\n`,
              [
                `            - <added> [ref=e7] button "Add item"`,
                `            - <removed> [ref=e5] button "Add item" [active]`,
                ``,
              ].join("\n")
            )
          : released
      )
    );
    expect(messages(timeline)).toEqual([
      notFullyWorkedOut("interaction_2"),
      notFullyWorkedOut("interaction_3"),
    ]);
  });

  it("has no Change Tree when no comparison can be made, and keeps its target and what was entered", async () => {
    const { header, timeline, rest } = await cartBeforeItsSecondClick();
    comparisonFails(true);
    for (const addition of rest) await timeline.add(addition);

    expect(await timeline.package(header)).toBe(
      cartPackage((released, nth) =>
        nth === 1 ? released : withoutChangeTree(released)
      )
    );
    // A step between two reads that no Interaction spans cannot be
    // compared either: whether the page changed there is not known.
    expect(messages(timeline)).toEqual([
      maybeChangedAfter("interaction_1"),
      notWorkedOut("interaction_2"),
      maybeChangedAfter("interaction_2"),
      notWorkedOut("interaction_3"),
      maybeChangedAfter("interaction_3"),
    ]);
  });

  it("stays in the recording with what Playwright reported of it when nothing of it can be measured: its type, its selector, its values and its place in the trace", async () => {
    const { header, timeline, rest } = await cartBeforeItsSecondClick();
    vi.spyOn(StructuralTree.prototype, "getAncestorsOf").mockImplementation(
      () => {
        throw new Error("Structural tree contains a parent cycle at e5");
      }
    );
    for (const addition of rest) await timeline.add(addition);

    const text = (await timeline.package(
      header,
      tracePositions({ snapshot_3: "31", snapshot_4: "42" })
    ))!;

    expect(text.split("traceActionPoints:")[0]).toBe(
      cartPackage((released, nth) =>
        nth === 1
          ? released
          : withoutChangeTree(released).replace(
              /targetRef: e\d/,
              "targetRef: null"
            )
      ).split("traceActionPoints:")[0]
    );
    expect(text).toContain(
      [
        `  - interactionId: interaction_2`,
        `    pageId: page_1`,
        `    beforeSnapshotId: "31"`,
        `    afterSnapshotId: "42"`,
      ].join("\n")
    );
    expect(messages(timeline)).toEqual([
      notWorkedOut("interaction_2"),
      notWorkedOut("interaction_3"),
    ]);
  });
});

describe("typing whose picture of the page cannot be read at all", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stays in the recording with its text, and with no target and no Change Tree", async () => {
    const empty = page(`- textbox "Item" [ref=e2]`);
    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, empty),
      snapshot(s(2), 20, page(`- textbox "Item" [ref=e2]: m`)),
    ]);
    // Core compares the two reads for the picture, and fails.
    vi.spyOn(StructuralTree, "reconcile").mockImplementation(() => {
      throw new Error("no comparison");
    });
    await timeline.add({
      kind: "interaction",
      interaction: {
        page: pageId("page_1"),
        report: {
          type: "fill",
          selector: 'internal:role=textbox[name="Item"i]',
          target: { ref: pictureRef("e2"), tree: empty },
          values: { text: "m" },
        },
        before: s(1),
        after: s(2),
        at: 15,
        beforeFromReport: true,
      },
    });

    expect(await timeline.package(header)).toContain(
      [
        `    timelineEntries:`,
        `      - kind: interaction`,
        `        timestamp: 15`,
        `        interaction:`,
        `          id: interaction_1`,
        `          type: fill`,
        `          targetRef: null`,
        `          targetSelector: internal:role=textbox[name="Item"i]`,
        `          text: m`,
        `traceActionPoints: []`,
      ].join("\n")
    );
    expect(messages(timeline)).toEqual([notWorkedOut("interaction_1")]);
  });
});

describe("a Visit's first tree that cannot be written under its elements' first refs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is written under the refs the page gave, and warned of", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, counter(0)),
      // The page re-created the button before the first step.
      snapshot(
        s(2),
        20,
        page(`- button "Add" [ref=e9]`, `- paragraph [ref=e3]: Count 0`)
      ),
      snapshot(
        s(3),
        30,
        page(`- button "Add" [ref=e9]`, `- paragraph [ref=e3]: Count 1`)
      ),
      click(s(2), s(3), 25),
    ]);
    vi.spyOn(StructuralTree.prototype, "findDuplicateRef").mockReturnValue(
      "e2" as AriaRef
    );

    const text = (await timeline.package(header))!;

    expect(baselineOf(text, "visit_1")).toBe(
      [
        ``,
        `      - [ref=e1]:`,
        `        - [ref=e9] button "Add"`,
        `        - [ref=e3] paragraph: Count 0`,
      ].join("\n")
    );
    expect(text).toContain("targetRef: e2");
    expect(timeline.warnings()).toEqual([
      {
        kind: "changesNotWorkedOut",
        message:
          "The baselineTree of visit_1 could not be fully worked out. An element the page re-created before its first step may be listed under another ref.",
      },
    ]);
  });
});
