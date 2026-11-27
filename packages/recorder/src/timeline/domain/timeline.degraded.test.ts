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
  snapshotRefOf,
  tracePositions,
} from "../../../testing/ids";

// A recording goes on when a read of the page cannot be kept or a step's
// changes cannot be worked out: the step stays, with as much as can be told
// of it, and a warning names it. A read that cannot be kept holds its place
// and is never compared: what is not known is left out, never made up.

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

/**
 * A read core's parser refuses, as Playwright 1.64 returned it for
 * `<main><label for="note">Note</label><input id="note"
 * placeholder="First line\u2028second line"><button>Save</button></main>`:
 * the placeholder holds a line separator (U+2028), which the parser's
 * pattern for a property line does not match.
 */
const unreadable = [
  `- main [ref=e2]:`,
  `  - text: Note`,
  `  - textbox "Note" [ref=e3]:`,
  `    - /placeholder: First line\u2028second line`,
  `  - button "Save" [ref=e4]`,
].join("\n");

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
  `changesNotWorkedOut: The changes of ${id} could not be worked out, so it has no change list.`;
/** `subject` names an Interaction's changes by its id, and a change of the
 * page's own by its time and the Interaction before it, or its Visit. */
const notFullyWorkedOut = (subject: string) =>
  `changesNotWorkedOut: ${subject} could not be fully worked out. An element the page re-created may be listed under another ref, or as removed and added.`;
const notListed = (subject: string) =>
  `changesNotWorkedOut: ${subject} cannot be listed in the recorder window. The recording package is not affected.`;
const maybeChanged = (where: string) =>
  `changesNotWorkedOut: Whether the page changed by itself ${where} could not be worked out: no such change is listed.`;

/** Whether core marked what changed on the tree's nodes: a read has no
 * marks. */
const isChangeTree = (tree: StructuralTree) =>
  tree.getAllNodes().some((node) => node.status !== undefined);

const s = (number: number) => snapshotId(`snapshot_${number}`);

/** The timeline's warnings, each as its kind and its message. */
const messages = (timeline: Timeline) =>
  timeline.warnings().map(({ kind, message }) => `${kind}: ${message}`);

/** The package's text from a Visit's first tree to its entries. */
const baselineOf = (text: string, visitId: string) =>
  text
    .split(`visitId: ${visitId}\n`)[1]!
    .split("    baselineTree:")[1]!
    .split("\n    timelineEntries:")[0]!;

const changed = (...rows: string[]) =>
  [`- [ref=e1]:`, ...rows.map((row) => `  - <changed> ${row}`)].join("\n");

const notReadBefore = (id: string) =>
  `pageNotRead: The page could not be read before ${id}, so its target is known by its selector only and it has no change list.`;
const notReadAfter = (id: string) =>
  `pageNotRead: The page could not be read after ${id}, so its change list is missing, or stops at the last read before that.`;
const lostRead = (visitId: string, where: string) =>
  `pageNotRead: A read of the page in ${visitId}, ${where}, could not be kept: whether the page changed by itself around it is not known.`;
const lostStart = (visitId: string, where: string) =>
  `pageNotRead: The page could not be read where ${visitId} starts in the recording, ${where}: its baselineTree is empty.`;
const notReadWhereItLed = (id: string, visitId: string) =>
  `pageNotRead: The page ${id} led to, in ${visitId}, could not be read at first: what it showed then is not known.`;

describe("a read of the page that cannot be kept", () => {
  it("holds its place and is compared with nothing: the step that ends at it and the step that starts at it have no Change Tree, and the steps after are as ever", async () => {
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
      { kind: "interaction", changeTree: null },
      {
        kind: "interaction",
        changeTree: changed(`[ref=e3] paragraph: Count 3`),
      },
    ]);
    // The first is found on the page before it; the second has no page
    // before it.
    expect(text).toContain(
      [
        `          id: interaction_1`,
        `          type: click`,
        `          targetRef: e2`,
      ].join("\n")
    );
    expect(text).toContain(
      [
        `          id: interaction_2`,
        `          type: click`,
        `          targetRef: null`,
      ].join("\n")
    );
    expect(messages(timeline)).toEqual([
      notReadAfter("interaction_1"),
      notReadBefore("interaction_2"),
    ]);
  });

  it("gives what the page showed at the next read to no step: neither the step it ends nor a change of the page's own", async () => {
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
      {
        kind: "interaction",
        changeTree: changed(`[ref=e3] paragraph: Count 2`),
      },
    ]);
    expect(messages(timeline)).toEqual([notReadAfter("interaction_1")]);
  });

  it("leaves a Visit that starts at it with an empty first tree, and warned of", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, unreadable),
      snapshot(s(2), 20, counter(1)),
      click(s(1), s(2), 15),
    ]);

    const text = (await timeline.package(header))!;

    expect(baselineOf(text, "visit_1")).toBe(" []");
    expect(changeTreesOf(text)).toEqual([
      { kind: "interaction", changeTree: null },
    ]);
    expect(messages(timeline)).toEqual([
      notReadBefore("interaction_1"),
      lostStart("visit_1", "at 10"),
    ]);
  });

  it("holds its place when one ref names two of its elements, which core's record of the elements refuses", async () => {
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
      snapshot(s(4), 40, counter(3)),
      click(s(3), s(4), 35),
    ]);

    expect(changeTreesOf((await timeline.package(header))!)).toEqual([
      { kind: "interaction", changeTree: null },
      {
        kind: "interaction",
        changeTree: changed(`[ref=e3] paragraph: Count 3`),
      },
    ]);
    expect(messages(timeline)).toEqual([notReadAfter("interaction_1")]);
  });

  it("leaves a Visit that starts at it with an empty first tree also when the page was read before it: no earlier read stands in for it, and the warning says where the trace holds it", async () => {
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

    const text = (await timeline.package(
      header,
      tracePositions({ snapshot_3: "33" })
    ))!;

    expect(baselineOf(text, "visit_2")).toBe(" []");
    expect(changeTreesOf(text)).toEqual([
      {
        kind: "interaction",
        changeTree: changed(`[ref=e3] paragraph: Count 1`),
      },
      { kind: "interaction", changeTree: null },
    ]);
    expect(messages(timeline)).toEqual([
      notReadBefore("interaction_2"),
      lostStart("visit_2", "at 30 (trace position 33)"),
    ]);
  });

  it("is warned of at the end when no Interaction starts or ends at it: the step before it and the step after it are as ever, and what the page changed by itself around it is not listed", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, counter(0)),
      snapshot(s(2), 20, counter(1)),
      click(s(1), s(2), 15),
      snapshot(s(3), 30, unreadable),
      // The page went on by itself.
      snapshot(s(4), 40, counter(5)),
      snapshot(s(5), 50, counter(6)),
      click(s(4), s(5), 45),
    ]);

    const text = (await timeline.package(
      header,
      tracePositions({ snapshot_3: "33" })
    ))!;

    expect(changeTreesOf(text)).toEqual([
      {
        kind: "interaction",
        changeTree: changed(`[ref=e3] paragraph: Count 1`),
      },
      {
        kind: "interaction",
        changeTree: changed(`[ref=e3] paragraph: Count 6`),
      },
    ]);
    expect(messages(timeline)).toEqual([
      lostRead("visit_1", "at 30 (trace position 33)"),
    ]);
  });

  it("is warned of when a Visit nothing was done in starts at it, as the page a click went on to", async () => {
    const next = "http://shop.test/next";
    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, counter(0)),
      click(s(1), s(2), 15),
      { kind: "visit", page: pageId("page_1"), url: next, cause: "navigate" },
      snapshot(s(2), 20, unreadable, next),
    ]);

    const text = (await timeline.package(header))!;

    expect(baselineOf(text, "visit_2")).toBe(" []");
    expect(messages(timeline)).toEqual([lostStart("visit_2", "at 20")]);
  });

  it("carries nothing over a pause it could not read the end of, neither the page before it as a Visit's first tree nor that page's refs: the page may have loaded again while paused", async () => {
    // The page as it loaded again: the same button, under a ref of its own.
    const reloaded = (count: number) =>
      page(
        `- button "Add" [ref=e7]`,
        `- paragraph [ref=e8]: Count ${count}`,
        `- status [ref=e9]: Loaded again`
      );
    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, counter(0)),
      // Paused, and the page loaded again. Neither the read where
      // recording resumes nor the read before the first click is kept.
      { ...snapshot(s(2), 20, unreadable), resumes: true },
      snapshot(s(3), 30, unreadable),
      snapshot(s(4), 40, reloaded(1)),
      click(s(3), s(4), 35),
      snapshot(s(5), 50, reloaded(2)),
      click(s(4), s(5), 45),
    ]);

    const text = (await timeline.package(header))!;

    expect(baselineOf(text, "visit_1")).toBe(" []");
    expect(changeTreesOf(text)).toEqual([
      { kind: "interaction", changeTree: null },
      {
        kind: "interaction",
        changeTree: changed(`[ref=e8] paragraph: Count 2`),
      },
    ]);
    // Not e2, the ref of the button on the page before the pause.
    expect(text).toContain(
      [
        `          id: interaction_2`,
        `          type: click`,
        `          targetRef: e7`,
      ].join("\n")
    );
    expect(messages(timeline)).toEqual([
      notReadBefore("interaction_1"),
      lostRead("visit_1", "at 20"),
      lostStart("visit_1", "at 30"),
    ]);
  });

  it("is warned of once for a step that starts and ends at reads that could not be kept", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, unreadable),
      snapshot(s(2), 20, unreadable),
      click(s(1), s(2), 15),
    ]);

    expect(messages(timeline)).toEqual([
      "pageNotRead: The page could not be read before interaction_1 or after it, so its target is known by its selector only and it has no change list.",
    ]);
  });

  it("is warned of when a click led to it on another page that was read again before anything else was done", async () => {
    const next = "http://shop.test/next";
    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, counter(0)),
      { kind: "visit", page: pageId("page_1"), url: next, cause: "navigate" },
      snapshot(s(2), 20, unreadable, next),
      click(s(1), s(2), 15),
      snapshot(s(3), 30, counter(7), next),
    ]);

    const text = (await timeline.package(header))!;

    expect(baselineOf(text, "visit_2")).toContain("Count 7");
    expect(messages(timeline)).toEqual([
      notReadWhereItLed("interaction_1", "visit_2"),
    ]);
  });

  describe("where recording resumes after a pause", () => {
    const banner = (count: number) =>
      page(
        `- button "Add" [ref=e2]`,
        `- paragraph [ref=e3]: Count ${count}`,
        `- status [ref=e4]: Synced while paused`
      );
    const first = [
      visit,
      snapshot(s(1), 10, counter(0)),
      snapshot(s(2), 20, counter(1)),
      click(s(1), s(2), 15),
      // While paused the count went to 5 and a status appeared.
      { ...snapshot(s(3), 30, unreadable), resumes: true },
    ] satisfies TimelineAddition[];

    it("leaves a click that starts at it with no Change Tree: nothing is compared across the pause", async () => {
      const timeline = await timelineOf([
        ...first,
        snapshot(s(4), 40, banner(6)),
        click(s(3), s(4), 35),
        snapshot(s(5), 50, banner(7)),
        click(s(4), s(5), 45),
      ]);

      const text = (await timeline.package(header))!;

      expect(changeTreesOf(text)).toEqual([
        {
          kind: "interaction",
          changeTree: changed(`[ref=e3] paragraph: Count 1`),
        },
        { kind: "interaction", changeTree: null },
        {
          kind: "interaction",
          changeTree: changed(`[ref=e3] paragraph: Count 7`),
        },
      ]);
      expect(text).not.toContain("<added>");
      expect(messages(timeline)).toEqual([notReadBefore("interaction_2")]);
    });

    it("leaves the refs of a recording whose read there was kept as they were: an element re-created before the pause keeps its first ref after it", async () => {
      const recreated = (count: number) =>
        page(`- button "Add" [ref=e9]`, `- paragraph [ref=e3]: Count ${count}`);
      const timeline = await timelineOf([
        visit,
        snapshot(s(1), 10, counter(0)),
        snapshot(s(2), 20, recreated(1)),
        click(s(1), s(2), 15),
        { ...snapshot(s(3), 30, recreated(1)), resumes: true },
        snapshot(s(4), 40, recreated(1)),
        snapshot(s(5), 50, recreated(2)),
        click(s(4), s(5), 45),
      ]);

      expect(await timeline.package(header)).toContain(
        [
          `          id: interaction_2`,
          `          type: click`,
          `          targetRef: e2`,
        ].join("\n")
      );
      expect(messages(timeline)).toEqual([]);
    });

    it("makes the first read kept after it the point to compare from: a click that starts there shows its own change only", async () => {
      const timeline = await timelineOf([
        ...first,
        snapshot(s(4), 40, banner(5)),
        snapshot(s(5), 50, banner(6)),
        click(s(4), s(5), 45),
      ]);

      const text = (await timeline.package(header))!;

      expect(changeTreesOf(text)).toEqual([
        {
          kind: "interaction",
          changeTree: changed(`[ref=e3] paragraph: Count 1`),
        },
        {
          kind: "interaction",
          changeTree: changed(`[ref=e3] paragraph: Count 6`),
        },
      ]);
      expect(messages(timeline)).toEqual([lostRead("visit_1", "at 30")]);
    });
  });

  describe("after typing", () => {
    const empty = page(`- textbox "Item" [ref=e2]`);
    /** Typing under a key. Its picture of the page at the first key shows
     * a help text the page had just rendered. */
    const typing = (after: SnapshotId, text: string): TimelineAddition => ({
      kind: "interaction",
      key: "fill_1",
      interaction: {
        page: pageId("page_1"),
        report: {
          type: "fill",
          selector: 'internal:role=textbox[name="Item"i]',
          target: {
            ref: pictureRef("e21"),
            tree: [
              `- generic [ref=e20]:`,
              `  - textbox "Item" [ref=e21]: m`,
              `  - paragraph [ref=e22]: Up to 40 letters`,
            ].join("\n"),
          },
          values: { text },
        },
        before: s(1),
        after,
        at: 15,
        beforeFromReport: true,
      },
    });
    const withHelp = (text: string) =>
      page(
        `- textbox "Item" [ref=e2]: ${text}`,
        `- paragraph [ref=e3]: Up to 40 letters`
      );

    it("stays as it was reported, with its latest text, when the read before it is the one that could not be kept: no read after it makes up for that", async () => {
      const timeline = await timelineOf([
        visit,
        snapshot(s(1), 10, unreadable),
        snapshot(s(2), 20, withHelp("m")),
        typing(s(2), "m"),
        snapshot(s(3), 30, withHelp("mi")),
        typing(s(3), "mi"),
      ]);

      const text = (await timeline.package(header))!;

      expect(text).toContain(
        [
          `          targetRef: null`,
          `          targetSelector: internal:role=textbox[name="Item"i]`,
          `          text: mi`,
        ].join("\n")
      );
      expect(changeTreesOf(text)).toEqual([
        { kind: "interaction", changeTree: null },
      ]);
      expect(messages(timeline)).toEqual([
        notReadBefore("interaction_1"),
        lostStart("visit_1", "at 10"),
      ]);
    });

    it("invents no change: what its picture shows is compared with no earlier page", async () => {
      const timeline = await timelineOf([
        visit,
        snapshot(s(1), 10, empty),
        snapshot(s(2), 20, unreadable),
        typing(s(2), "m"),
      ]);

      const text = (await timeline.package(header))!;

      expect(text).not.toContain("<removed>");
      expect(changeTreesOf(text).at(-1)).toEqual({
        kind: "interaction",
        changeTree: null,
      });
      expect(messages(timeline)).toEqual([notReadAfter("interaction_1")]);
    });

    it("keeps what it changed up to its last kept read, with its latest text and the failed read's place in the trace, and is measured again at the next kept read", async () => {
      const timeline = await timelineOf([
        visit,
        snapshot(s(1), 10, empty),
        snapshot(s(2), 20, withHelp("m")),
        typing(s(2), "m"),
        snapshot(s(3), 30, unreadable),
        typing(s(3), "mi"),
        typing(s(3), "mil"),
      ]);
      const positions = tracePositions({
        snapshot_1: "11",
        snapshot_2: "22",
        snapshot_3: "33",
        snapshot_4: "44",
      });

      const lost = (await timeline.package(header, positions))!;

      expect(lost).toContain("text: mil");
      expect(changeTreesOf(lost).at(-1)).toEqual({
        kind: "interaction",
        changeTree: changed(`[ref=e2] textbox "Item": m`),
      });
      expect(lost).toContain(`    afterSnapshotId: "33"`);
      expect(messages(timeline)).toEqual([notReadAfter("interaction_1")]);

      await timeline.add(snapshot(s(4), 40, withHelp("milk")));
      await timeline.add(typing(s(4), "milk"));

      expect(
        changeTreesOf((await timeline.package(header, positions))!).at(-1)
      ).toEqual({
        kind: "interaction",
        changeTree: changed(`[ref=e2] textbox "Item": milk`),
      });
    });
  });

  it("moves a fill's place in the trace on to it when it is the fill's latest read, also when nothing else of the fill is new", async () => {
    const fill = (after: SnapshotId): TimelineAddition => ({
      kind: "interaction",
      key: "fill_1",
      interaction: {
        page: pageId("page_1"),
        report: {
          type: "fill",
          selector: 'internal:role=textbox[name="Item"i]',
          target: null,
          values: { text: "m" },
        },
        before: s(1),
        after,
        at: 15,
      },
    });
    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, page(`- textbox "Item" [ref=e2]`)),
      // The fill ends at the read it started at, the Visit's first.
      fill(s(1)),
      fill(s(1)),
    ]);
    const positions = tracePositions({
      snapshot_1: "11",
      snapshot_2: "22",
      snapshot_3: "33",
    });

    expect(await timeline.package(header, positions)).toContain(
      [
        `    afterSnapshotId: "11"`,
        `    startedAt: 15`,
        `    endedAt: 10`,
      ].join("\n")
    );

    await timeline.add(
      snapshot(s(2), 20, page(`- textbox "Item" [ref=e2]: m`))
    );
    await timeline.add(fill(s(2)));
    await timeline.add(snapshot(s(3), 30, unreadable));
    await timeline.add(fill(s(3)));

    expect(await timeline.package(header, positions)).toContain(
      [
        `    afterSnapshotId: "33"`,
        `    startedAt: 15`,
        `    endedAt: 30`,
      ].join("\n")
    );
  });

  it("leaves an assertion whose element was picked in it with its selector only: a ref of an earlier read may name another element", async () => {
    const saved = page(
      `- button "Save" [ref=e2]`,
      `- paragraph [ref=e3]: Saved`
    );
    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, saved),
      snapshot(s(2), 20, unreadable),
      {
        kind: "interaction",
        interaction: {
          page: pageId("page_1"),
          report: {
            type: "assertVisible",
            selector: 'internal:role=paragraph >> internal:has-text="Saved"i',
            target: null,
            // The read before has an element under this ref too.
            snapshotTarget: snapshotRefOf("e3"),
            locator: "getByRole('paragraph').filter({ hasText: 'Saved' })",
            values: {},
          },
          before: s(1),
          after: s(1),
          at: 10,
          targetRead: s(2),
        },
      },
    ]);

    expect(timeline.visits()[0]!.entries[0]).toMatchObject({
      interaction: {
        targetRef: null,
        targetSelector: 'internal:role=paragraph >> internal:has-text="Saved"i',
      },
      targetElement: "getByRole('paragraph').filter({ hasText: 'Saved' })",
    });
    expect(messages(timeline)).toEqual([
      "pageNotRead: The page could not be read where interaction_1 picked its element, so its target is known by its selector only.",
    ]);
  });

  it("finds an entry's target by its selector while it is the page's latest read: no ref of an earlier read is asked for", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, counter(0)),
      snapshot(s(2), 20, counter(1)),
      click(s(1), s(2), 15),
      snapshot(s(3), 30, unreadable),
    ]);

    expect(timeline.liveTarget(entryId("interaction_1"))).toEqual({
      page: pageId("page_1"),
      find: { by: "selector", selector: 'internal:role=button[name="Add"i]' },
    });
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

  it("costs the next click the focus its press moved, which shows against the read before it; an element the lost read was the first to show re-created still keeps its first ref", async () => {
    const recording = cart();
    // The read after the second click: the first to show "Add item"
    // re-created, under e7.
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
      cartPackage((released, nth) =>
        nth === 1
          ? released
          : nth === 2
            ? withoutChangeTree(released)
            : // The focus its press moved shows against the read before
              // it, which is the one that could not be kept.
              released
                .replace(
                  `            - <changed> [ref=e5] button "Add item" [active]\n`,
                  ""
                )
                .replace(
                  `            - <changed> [ref=e6] button "Redraw"\n`,
                  ""
                )
      )
    );
    expect(messages(timeline)).toEqual([notReadAfter("interaction_2")]);
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
    // It has no row to find an element by either.
    expect(timeline.liveTarget(entryId("interaction_3"), 0)).toBeNull();
    expect(messages(timeline)).toEqual(
      [1, 2, 3].map((nth) => notListed(`The changes of interaction_${nth}`))
    );
  });

  describe("when its elements cannot be written under their first refs", () => {
    // Core keeps the later ref of an element it matched under two.
    const underOwnRefs = fixture("cart-flow.package.txt").replaceAll(
      `<changed> [ref=e5] button "Add item"`,
      `<changed> [ref=e7] button "Add item"`
    );
    const warned = [1, 2, 3].map((nth) =>
      notFullyWorkedOut(`The changes of interaction_${nth}`)
    );

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
      expect(messages(timeline)).toEqual(warned);
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
      expect(messages(timeline)).toEqual(warned);
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
      notFullyWorkedOut("The changes of interaction_2"),
      notFullyWorkedOut("The changes of interaction_3"),
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
      maybeChanged("at 2942.489 after interaction_1"),
      notWorkedOut("interaction_2"),
      maybeChanged("at 4556.149 after interaction_2"),
      notWorkedOut("interaction_3"),
      maybeChanged("at 6939.468 after interaction_3"),
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

describe("a change of the page's own that a warning is about", () => {
  afterEach(() => vi.restoreAllMocks());

  /** Makes the rows of every Change Tree impossible to name. */
  const rowsCannotBeNamed = () => {
    const ancestorsOf = StructuralTree.prototype.getAncestorsOf;
    vi.spyOn(StructuralTree.prototype, "getAncestorsOf").mockImplementation(
      function (this: StructuralTree, ref) {
        if (isChangeTree(this))
          throw new Error("Structural tree contains a parent cycle at e5");
        return ancestorsOf.call(this, ref);
      }
    );
  };
  /** Typing "m" under a key. Its picture of the page at the first key
   * shows a help text the read before it does not have. */
  const typing = (after: SnapshotId | null): TimelineAddition => ({
    kind: "interaction",
    key: "fill_1",
    interaction: {
      page: pageId("page_1"),
      report: {
        type: "fill",
        selector: 'internal:role=textbox[name="Item"i]',
        target: {
          ref: pictureRef("e21"),
          tree: [
            `- generic [ref=e20]:`,
            `  - textbox "Item" [ref=e21]: m`,
            `  - paragraph [ref=e22]: Up to 40 letters`,
          ].join("\n"),
        },
        values: { text: "m" },
      },
      before: s(1),
      after,
      at: 15,
      beforeFromReport: true,
    },
  });
  const empty = page(`- textbox "Item" [ref=e2]`);
  const withHelp = page(
    `- textbox "Item" [ref=e2]: m`,
    `- paragraph [ref=e3]: Up to 40 letters`
  );

  it("is named by its time and the Interaction before it: the package writes no id for one", async () => {
    rowsCannotBeNamed();

    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, counter(0)),
      snapshot(s(2), 20, counter(1)),
      click(s(1), s(2), 15),
      // The page went on by itself, twice.
      snapshot(s(3), 30, counter(5)),
      snapshot(s(5), 32, counter(7)),
      snapshot(s(4), 40, counter(8)),
      click(s(5), s(4), 35),
    ]);

    expect(await timeline.package(header)).toContain(
      [`      - kind: change`, `        timestamp: 30`].join("\n")
    );
    expect(messages(timeline)).toEqual([
      notListed("The changes of interaction_1"),
      notListed("The page's own change at 30 after interaction_1"),
      notListed("The page's own change at 32 after interaction_1"),
      notListed("The changes of interaction_2"),
    ]);
  });

  it("is named by its time and its Visit when no Interaction is before it, as what had changed by the first key of typing", async () => {
    rowsCannotBeNamed();

    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, empty),
      typing(null),
    ]);

    expect(messages(timeline)).toEqual([
      notListed("The page's own change at 15 in visit_1"),
    ]);
  });

  it("is warned of when a later read names its elements and its rows cannot be named again", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, empty),
      typing(null),
    ]);
    rowsCannotBeNamed();
    await timeline.add(snapshot(s(2), 20, withHelp));
    await timeline.add(typing(s(2)));

    expect(
      timeline.visits()[0]!.entries.map((entry) => [entry.kind, entry.changes])
    ).toEqual([
      ["change", []],
      ["interaction", []],
    ]);
    expect(messages(timeline)).toEqual([
      notListed("The page's own change at 15 in visit_1"),
      notListed("The changes of interaction_1"),
    ]);
  });

  it("is told apart from another after the same Interaction, by its time, when neither can be worked out", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(s(1), 10, counter(0)),
      snapshot(s(2), 20, counter(1)),
      click(s(1), s(2), 15),
    ]);
    comparisonFails(true);
    await timeline.add(snapshot(s(3), 30, counter(2)));
    await timeline.add(snapshot(s(4), 40, counter(3)));

    await timeline.package(header);

    expect(messages(timeline)).toEqual([
      maybeChanged("at 30 after interaction_1"),
      maybeChanged("at 40 after interaction_1"),
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
    expect(messages(timeline)).toEqual([
      "changesNotWorkedOut: The baselineTree of visit_1 could not be fully worked out. An element the page re-created before its first step may be listed under another ref.",
    ]);
  });
});
