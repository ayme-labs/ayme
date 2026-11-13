import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { PageSnapshot, TimelineAddition } from "./recorded";
import { Timeline, type PackageHeader } from "./timeline";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

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
const snapshot = (
  id: string,
  at: number,
  tree: string
): { kind: "snapshot"; snapshot: PageSnapshot } => ({
  kind: "snapshot",
  snapshot: { id, page: "page_1", url, at, tree },
});
const click = (
  before: string,
  after: string | null,
  target: { ref: string; tree: string } | null
): TimelineAddition => ({
  kind: "interaction",
  interaction: {
    page: "page_1",
    report: {
      type: "click",
      selector: 'internal:role=button[name="Save"i]',
      target,
      values: { clickCount: 1, modifiers: 0, button: "left" },
    },
    before,
    after,
    at: 15,
  },
});

async function packageOf(additions: readonly TimelineAddition[]) {
  const timeline = new Timeline();
  for (const addition of additions) await timeline.add(addition);
  return timeline.package(header);
}

// What the page looks like, as Playwright's AI-mode snapshot writes it.
const idle = [
  `- generic [ref=e1]:`,
  `  - button "Save" [ref=e2]`,
  `  - paragraph [ref=e3]: Not saved`,
].join("\n");
const savedPage = [
  `- generic [ref=e1]:`,
  `  - button "Save" [ref=e2]`,
  `  - paragraph [ref=e3]: Saved`,
].join("\n");

describe("the timeline", () => {
  it("writes three clicks as the released Recording Package", async () => {
    const recording = JSON.parse(fixture("cart-flow.recording.json")) as {
      header: PackageHeader;
      additions: TimelineAddition[];
    };
    const timeline = new Timeline();
    for (const addition of recording.additions) await timeline.add(addition);

    expect(await timeline.package(recording.header)).toBe(
      fixture("cart-flow.package.txt")
    );
  });

  it("has nothing to write while no page was read", async () => {
    expect(await packageOf([visit])).toBeNull();
  });

  it("writes a Visit without Interactions with its first snapshot and no entries", async () => {
    expect(await packageOf([visit, snapshot("snapshot_1", 10, idle)])).toBe(
      [
        `recordingId: rec_20261112T145047604Z`,
        `mode: structural`,
        `createdAt: 2026-11-12T14:50:47.604Z`,
        `url: http://shop.test/`,
        `tracePath: null`,
        `visits:`,
        `  - visitId: visit_1`,
        `    url: http://shop.test/`,
        `    cause: initial`,
        `    baselineTree:`,
        `      - [ref=e1]:`,
        `        - [ref=e2] button "Save"`,
        `        - [ref=e3] paragraph: Not saved`,
        `    timelineEntries: []`,
        `traceActionPoints: []`,
        ``,
      ].join("\n")
    );
  });

  it("gives an Interaction its target ref, its selector, what Playwright said of it, and a Change Tree of what it changed", async () => {
    const text = await packageOf([
      visit,
      snapshot("snapshot_1", 10, idle),
      snapshot("snapshot_2", 20, savedPage),
      click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
    ]);

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
        `          button: left`,
        `          modifiers: 0`,
        `          clickCount: 1`,
        `        changeTree:`,
        `          - [ref=e1]:`,
        `            - <changed> [ref=e3] paragraph: Saved`,
        `traceActionPoints: []`,
      ].join("\n")
    );
  });

  it("finds the target by its place in the report's own picture, whose refs are not the snapshot's", async () => {
    // Playwright's recorder numbers the page by itself: its e7 is the
    // snapshot's e2.
    const reportsPicture = [
      `- generic [ref=e5]:`,
      `  - button "Save" [ref=e7]`,
      `  - paragraph [ref=e9]: Not saved`,
    ].join("\n");

    const text = await packageOf([
      visit,
      snapshot("snapshot_1", 10, idle),
      snapshot("snapshot_2", 20, savedPage),
      click("snapshot_1", "snapshot_2", { ref: "e7", tree: reportsPicture }),
    ]);

    expect(text).toContain(`          targetRef: e2\n`);
  });

  it("writes a null target ref when the report's picture does not lead to the same element", async () => {
    const otherPage = [
      `- generic [ref=e1]:`,
      `  - link "Home" [ref=e2]`,
      `  - paragraph [ref=e3]: Not saved`,
    ].join("\n");

    const text = await packageOf([
      visit,
      snapshot("snapshot_1", 10, idle),
      snapshot("snapshot_2", 20, savedPage),
      click("snapshot_1", "snapshot_2", { ref: "e2", tree: otherPage }),
    ]);

    expect(text).toContain(
      [
        `          type: click`,
        `          targetRef: null`,
        `          targetSelector: internal:role=button[name="Save"i]`,
        ``,
      ].join("\n")
    );
  });

  it("writes a null target ref when the report names no target", async () => {
    const text = await packageOf([
      visit,
      snapshot("snapshot_1", 10, idle),
      snapshot("snapshot_2", 20, savedPage),
      click("snapshot_1", "snapshot_2", null),
    ]);

    expect(text).toContain(
      `          type: click\n          targetRef: null\n`
    );
  });

  it("keeps the first ref of an element the page re-creates, in later trees and as a target", async () => {
    // The page replaced the Save button by a new one: Playwright names it e8.
    const recreated = [
      `- generic [ref=e1]:`,
      `  - button "Save" [ref=e8]`,
      `  - paragraph [ref=e3]: Saved`,
    ].join("\n");
    const savedTwice = [
      `- generic [ref=e1]:`,
      `  - button "Save" [disabled] [ref=e8]`,
      `  - paragraph [ref=e3]: Saved twice`,
    ].join("\n");

    const text = await packageOf([
      visit,
      snapshot("snapshot_1", 10, idle),
      snapshot("snapshot_2", 20, recreated),
      click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
      snapshot("snapshot_3", 30, savedTwice),
      click("snapshot_2", "snapshot_3", { ref: "e8", tree: recreated }),
    ]);

    expect(text).not.toContain("e8");
    expect(text).toContain(
      [
        `          id: interaction_2`,
        `          type: click`,
        `          targetRef: e2`,
      ].join("\n")
    );
    expect(text).toContain(
      [
        `          - [ref=e1]:`,
        `            - <changed> [ref=e2] button "Save" [disabled]`,
        `            - <changed> [ref=e3] paragraph: Saved twice`,
      ].join("\n")
    );
  });

  it("keeps what changed between two Interactions apart from both, as a change of its own", async () => {
    const banner = [
      `- generic [ref=e1]:`,
      `  - button "Save" [ref=e2]`,
      `  - paragraph [ref=e3]: Saved`,
      `  - alert [ref=e4]: Offer ends soon`,
    ].join("\n");
    const bannerAndCount = banner.replace("Saved", "Saved twice");

    const text = await packageOf([
      visit,
      snapshot("snapshot_1", 10, idle),
      snapshot("snapshot_2", 20, savedPage),
      click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
      snapshot("snapshot_3", 30, banner),
      snapshot("snapshot_4", 40, bannerAndCount),
      click("snapshot_3", "snapshot_4", { ref: "e2", tree: banner }),
    ]);

    expect(text).toContain(
      [
        `      - kind: change`,
        `        timestamp: 30`,
        `        changeTree:`,
        `          - [ref=e1]:`,
        `            - <added> [ref=e4] alert: Offer ends soon`,
        `      - kind: interaction`,
        `        timestamp: 15`,
        `        interaction:`,
        `          id: interaction_2`,
      ].join("\n")
    );
    expect(text).toContain(
      [
        `        changeTree:`,
        `          - [ref=e1]:`,
        `            - <changed> [ref=e3] paragraph: Saved twice`,
        `traceActionPoints: []`,
      ].join("\n")
    );
  });

  it("writes what changed after the last Interaction as a change", async () => {
    const text = await packageOf([
      visit,
      snapshot("snapshot_1", 10, idle),
      snapshot("snapshot_2", 20, idle),
      click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
      snapshot("snapshot_3", 30, savedPage),
    ]);

    expect(text).toContain(
      [
        `          clickCount: 1`,
        `      - kind: change`,
        `        timestamp: 30`,
        `        changeTree:`,
        `          - [ref=e1]:`,
        `            - <changed> [ref=e3] paragraph: Saved`,
        `traceActionPoints: []`,
      ].join("\n")
    );
  });

  it("writes no change where nothing changed", async () => {
    const text = await packageOf([
      visit,
      snapshot("snapshot_1", 10, idle),
      snapshot("snapshot_2", 20, idle),
    ]);

    expect(text).toContain(`    timelineEntries: []\n`);
  });

  it("gives an Interaction whose page was gone before its 'after' no Change Tree", async () => {
    const text = await packageOf([
      visit,
      snapshot("snapshot_1", 10, idle),
      click("snapshot_1", null, { ref: "e2", tree: idle }),
    ]);

    expect(text).toContain(
      [`          clickCount: 1`, `traceActionPoints: []`, ``].join("\n")
    );
  });

  it("leaves out a snapshot of a page that has no Visit", async () => {
    expect(await packageOf([snapshot("snapshot_1", 10, idle)])).toBeNull();
  });
});
