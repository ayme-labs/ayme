import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { TimelineAddition } from "./recorded";
import { Timeline, type PackageHeader } from "./timeline";

// One ref names one element in a tree, always. An element the page
// re-creates keeps its first ref; that rule yields in one case only: when
// the element that first had the ref is in the tree too, it keeps the ref
// and the other has a ref of its own.

const header: PackageHeader = {
  recordingId: "rec_20261112T145047604Z",
  createdAt: "2026-11-12T14:50:47.604Z",
  tracePath: null,
};
const url = "http://shop.test/";
const visit: TimelineAddition = {
  kind: "visit",
  page: "page_1",
  url,
  cause: "initial",
};
const snapshot = (id: string, at: number, tree: string): TimelineAddition => ({
  kind: "snapshot",
  snapshot: { id, page: "page_1", url, at, tree },
});
/** A click on the element the report names `ref` in a picture that is the
 * page as `tree` has it. */
const click = (
  before: string,
  after: string,
  ref: string,
  tree: string
): TimelineAddition => ({
  kind: "interaction",
  interaction: {
    page: "page_1",
    report: {
      type: "click",
      selector: 'internal:role=button[name="Save"i]',
      target: { ref, tree },
      values: {},
    },
    before,
    after,
    at: 15,
  },
});
async function timelineOf(additions: readonly TimelineAddition[]) {
  const timeline = new Timeline();
  for (const addition of additions) await timeline.add(addition);
  return timeline;
}
const page = (...elements: string[]) =>
  [`- generic [ref=e1]:`, ...elements.map((line) => `  ${line}`)].join("\n");

/**
 * The refs that appear more than once in one tree of a package: in a
 * Visit's first tree, or in one Change Tree. A tree starts at its key and
 * holds the lines below it that stand further in.
 */
function refsTwiceInOneTree(text: string): string[] {
  const twice: string[] = [];
  const lines = text.split("\n");
  lines.forEach((line, start) => {
    const key = /^(\s*)(baselineTree|changeTree):$/.exec(line);
    if (!key) return;
    const seen = new Set<string>();
    for (const below of lines.slice(start + 1)) {
      if (below.search(/\S/) <= key[1]!.length) break;
      for (const [, ref] of below.matchAll(/\[ref=([^\]]+)\]/g)) {
        if (seen.has(ref!))
          twice.push(`${ref} in the ${key[2]} at line ${start + 1}`);
        seen.add(ref!);
      }
    }
  });
  return twice;
}

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("the refs of a package", () => {
  it("finds a ref that is twice in one tree, and none in a tree that names each element once", () => {
    expect(
      refsTwiceInOneTree(
        [
          `    baselineTree:`,
          `      - [ref=e1]:`,
          `        - [ref=e2] button "Save"`,
          `    timelineEntries:`,
          `      - kind: change`,
          `        changeTree:`,
          `          - [ref=e1]:`,
          `            - <changed> [ref=e2] button "Save"`,
          `            - <added> [ref=e2] button "Save"`,
          `traceActionPoints: []`,
        ].join("\n")
      )
    ).toEqual(["e2 in the changeTree at line 6"]);
  });

  it("are each one element's in every tree of the fixture's package, as the released recorder wrote it and as the timeline writes it", async () => {
    const recording = JSON.parse(fixture("cart-flow.recording.json")) as {
      header: PackageHeader;
      additions: TimelineAddition[];
    };
    const timeline = await timelineOf(recording.additions);

    expect(refsTwiceInOneTree(fixture("cart-flow.package.txt"))).toEqual([]);
    expect(
      refsTwiceInOneTree((await timeline.package(recording.header))!)
    ).toEqual([]);
  });
});

describe("an element the page re-created, and the original back beside it", () => {
  const original = page(`- button "Save" [ref=e2]`);
  // The page put a new button in its place: Playwright names it e8.
  const recreated = page(`- button "Save" [ref=e8]`);
  // The first button is back, beside the new one.
  const both = page(`- button "Save" [ref=e2]`, `- button "Save" [ref=e8]`);
  const bothDone = page(
    `- button "Save" [disabled] [ref=e2]`,
    `- button "Save" [disabled] [ref=e8]`
  );
  const flow = [
    visit,
    snapshot("snapshot_1", 10, original),
    snapshot("snapshot_2", 20, recreated),
    click("snapshot_1", "snapshot_2", "e2", original),
    snapshot("snapshot_3", 30, both),
    snapshot("snapshot_4", 40, bothDone),
    // A click on the new button.
    click("snapshot_3", "snapshot_4", "e8", both),
  ];

  it("are two elements under two refs: the one that first had the ref keeps it, the other has its own", async () => {
    const timeline = await timelineOf(flow);

    const text = (await timeline.package(header))!;
    expect(refsTwiceInOneTree(text)).toEqual([]);
    expect(text).toContain(
      [
        `    timelineEntries:`,
        `      - kind: interaction`,
        `        timestamp: 15`,
        `        interaction:`,
        `          id: interaction_1`,
        `          type: click`,
        `          targetRef: e2`,
        `          targetSelector: internal:role=button[name="Save"i]`,
        // The first button is back: the new one, which stood under its ref
        // while it was away, is no change.
        `      - kind: change`,
        `        timestamp: 30`,
        `        changeTree:`,
        `          - [ref=e1]:`,
        `            - <added> [ref=e2] button "Save"`,
        `      - kind: interaction`,
        `        timestamp: 15`,
        `        interaction:`,
        `          id: interaction_2`,
        `          type: click`,
        `          targetRef: e8`,
        `          targetSelector: internal:role=button[name="Save"i]`,
        `        changeTree:`,
        `          - [ref=e1]:`,
        `            - <changed> [ref=e2] button "Save" [disabled]`,
        `            - <changed> [ref=e8] button "Save" [disabled]`,
        `traceActionPoints: []`,
        ``,
      ].join("\n")
    );
  });

  it("are each found on the page by its own ref, for the highlight", async () => {
    const timeline = await timelineOf(flow);

    expect(timeline.liveTarget("interaction_1")).toMatchObject({ ref: "e2" });
    expect(timeline.liveTarget("interaction_2")).toMatchObject({ ref: "e8" });
  });

  it("keep their own refs once they have them: the new one is not under the first ref again when the original goes", async () => {
    const timeline = await timelineOf([
      ...flow,
      snapshot("snapshot_5", 50, page(`- button "Save" [ref=e8]`)),
    ]);

    const text = (await timeline.package(header))!;
    expect(refsTwiceInOneTree(text)).toEqual([]);
    expect(text).toContain(
      [
        `      - kind: change`,
        `        timestamp: 50`,
        `        changeTree:`,
        `          - [ref=e1]:`,
        `            - <removed> [ref=e2] button "Save" [disabled]`,
        `            - <changed> [ref=e8] button "Save"`,
        `traceActionPoints: []`,
        ``,
      ].join("\n")
    );
  });

  it("are not under one ref in a Change Tree that reaches from before the two stood side by side to after one is gone", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot("snapshot_1", 10, original),
      snapshot("snapshot_2", 20, recreated),
      click("snapshot_1", "snapshot_2", "e2", original),
      snapshot("snapshot_3", 30, both),
      snapshot("snapshot_4", 40, original),
      // From the new button alone to the first one alone.
      click("snapshot_2", "snapshot_4", "e8", recreated),
    ]);

    const text = (await timeline.package(header))!;
    expect(refsTwiceInOneTree(text)).toEqual([]);
    expect(text).toContain(
      [
        `          id: interaction_2`,
        `          type: click`,
        `          targetRef: e2`,
        `          targetSelector: internal:role=button[name="Save"i]`,
        `        changeTree:`,
        `          - [ref=e1]:`,
        `            - <added> [ref=e2] button "Save"`,
        `            - <removed> [ref=e8] button "Save"`,
        `traceActionPoints: []`,
        ``,
      ].join("\n")
    );
  });
});
