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

async function packageOf(
  additions: readonly TimelineAddition[],
  positions: Readonly<Record<string, string>> = {}
) {
  const timeline = new Timeline();
  for (const addition of additions) await timeline.add(addition);
  return timeline.package(header, positions);
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

  describe("the trace", () => {
    it("tells where an Interaction's snapshots are in the trace, as the stock trace tool numbers them", async () => {
      const text = await packageOf(
        [
          visit,
          snapshot("snapshot_1", 10, idle),
          snapshot("snapshot_2", 20, savedPage),
          click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
        ],
        { snapshot_1: "11", snapshot_2: "17" }
      );

      expect(text).toMatch(
        [
          `traceActionPoints:`,
          `  - interactionId: interaction_1`,
          `    pageId: page_1`,
          `    beforeSnapshotId: "11"`,
          `    afterSnapshotId: "17"`,
          `    startedAt: 15`,
          `    endedAt: 20`,
          ``,
        ].join("\n")
      );
    });

    it("gives an Interaction that left its page a before and no after", async () => {
      const text = await packageOf(
        [
          visit,
          snapshot("snapshot_1", 10, idle),
          click("snapshot_1", null, { ref: "e2", tree: idle }),
        ],
        { snapshot_1: "11" }
      );

      expect(text).toMatch(
        [
          `traceActionPoints:`,
          `  - interactionId: interaction_1`,
          `    pageId: page_1`,
          `    beforeSnapshotId: "11"`,
          `    startedAt: 15`,
          `    endedAt: 15`,
          ``,
        ].join("\n")
      );
    });

    it("gives an Interaction that left its Visit a before and no after: its after is the next Visit's first picture", async () => {
      const text = await packageOf(
        [
          visit,
          snapshot("snapshot_1", 10, idle),
          {
            kind: "visit",
            page: "page_1",
            url: `${url}cart`,
            cause: "navigate",
          },
          snapshot("snapshot_2", 20, savedPage),
          click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
        ],
        { snapshot_1: "11", snapshot_2: "17" }
      );

      expect(text).toContain(
        [
          `traceActionPoints:`,
          `  - interactionId: interaction_1`,
          `    pageId: page_1`,
          `    beforeSnapshotId: "11"`,
          `    startedAt: 15`,
          `    endedAt: 20`,
          ``,
        ].join("\n")
      );
    });

    it("lists the Interactions in the order they were recorded, each with its own positions", async () => {
      const text = await packageOf(
        [
          visit,
          snapshot("snapshot_1", 10, idle),
          snapshot("snapshot_2", 20, savedPage),
          click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
          click("snapshot_2", null, { ref: "e2", tree: savedPage }),
        ],
        { snapshot_1: "11", snapshot_2: "17" }
      );

      expect(text).toMatch(
        /interactionId: interaction_1[^]*interactionId: interaction_2\n {4}pageId: page_1\n {4}beforeSnapshotId: "17"\n/
      );
    });
  });

  it("has nothing to write while no page was read", async () => {
    expect(await packageOf([visit])).toBeNull();
  });

  it("has nothing to write while no Interaction was recorded, as the released recorder: a started recording without one is empty", async () => {
    expect(
      await packageOf([
        visit,
        snapshot("snapshot_1", 10, idle),
        snapshot("snapshot_2", 20, savedPage),
      ])
    ).toBeNull();
  });

  it("writes a Visit without Interactions, beside one that has one, with its first snapshot and no entries", async () => {
    const text = await packageOf([
      visit,
      { kind: "visit", page: "page_2", url: `${url}help`, cause: "openPage" },
      snapshot("snapshot_1", 10, idle),
      {
        kind: "snapshot",
        snapshot: {
          id: "snapshot_2",
          page: "page_2",
          url: `${url}help`,
          at: 11,
          tree: idle,
        },
      },
      click("snapshot_1", null, null),
    ]);

    expect(text).toContain(
      [
        `  - visitId: visit_2`,
        `    url: http://shop.test/help`,
        `    cause: openPage`,
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
      snapshot("snapshot_3", 30, idle),
      click("snapshot_2", "snapshot_3", null),
    ]);

    expect(text).toContain("kind: interaction");
    expect(text).not.toContain("kind: change");
    expect(text).not.toContain("changeTree");
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

  describe("as it is told live", () => {
    const visitWith = (entries: unknown[]) => [
      { visitId: "visit_1", url, cause: "initial", entries },
    ];
    const savedByClick = {
      kind: "interaction",
      id: "interaction_1",
      timestamp: 15,
      interaction: {
        id: "interaction_1",
        type: "click",
        targetRef: "e2",
        targetSelector: 'internal:role=button[name="Save"i]',
        button: "left",
        modifiers: 0,
        clickCount: 1,
      },
      changeTree: [
        `- [ref=e1]:`,
        `  - <changed> [ref=e3] paragraph: Saved`,
      ].join("\n"),
    };

    it("has no Visit before one starts, and a Visit without entries once it has", async () => {
      const timeline = new Timeline();
      expect(timeline.visits()).toEqual([]);

      await timeline.add(visit);

      expect(timeline.visits()).toEqual(visitWith([]));
    });

    it("has an Interaction's entry once the Interaction is added, not when its snapshots are", async () => {
      const timeline = new Timeline();
      await timeline.add(visit);
      await timeline.add(snapshot("snapshot_1", 10, idle));
      await timeline.add(snapshot("snapshot_2", 20, savedPage));
      expect(timeline.visits()).toEqual(visitWith([]));

      await timeline.add(
        click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle })
      );

      expect(timeline.visits()).toEqual(visitWith([savedByClick]));
    });

    it("has a change of no Interaction with the next Interaction, and one after the last when the package is made", async () => {
      const banner = `${savedPage}\n  - alert [ref=e4]: Offer ends soon`;
      const timeline = new Timeline();
      await timeline.add(visit);
      await timeline.add(snapshot("snapshot_1", 10, idle));
      await timeline.add(snapshot("snapshot_2", 20, savedPage));
      await timeline.add(
        click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle })
      );
      await timeline.add(snapshot("snapshot_3", 30, banner));
      await timeline.add(snapshot("snapshot_4", 40, banner));
      expect(timeline.visits()).toEqual(visitWith([savedByClick]));

      await timeline.add(
        click("snapshot_3", "snapshot_4", { ref: "e2", tree: banner })
      );
      const offer = {
        kind: "change",
        id: "change_1",
        timestamp: 30,
        changeTree: [
          `- [ref=e1]:`,
          `  - <added> [ref=e4] alert: Offer ends soon`,
        ].join("\n"),
      };
      const secondClick = {
        kind: "interaction",
        id: "interaction_2",
        timestamp: 15,
        interaction: { ...savedByClick.interaction, id: "interaction_2" },
        // It changed nothing.
        changeTree: null,
      };
      expect(timeline.visits()).toEqual(
        visitWith([savedByClick, offer, secondClick])
      );

      await timeline.add(snapshot("snapshot_5", 50, idle));
      expect(timeline.visits()).toEqual(
        visitWith([savedByClick, offer, secondClick])
      );
      await timeline.package(header);

      expect(timeline.visits()[0]!.entries).toHaveLength(4);
      expect(timeline.visits()[0]!.entries[3]).toMatchObject({
        kind: "change",
        timestamp: 50,
      });
    });

    it("is a new list only when something was added to it", async () => {
      const timeline = new Timeline();
      await timeline.add(visit);
      const before = timeline.visits();
      await timeline.add(snapshot("snapshot_1", 10, idle));

      expect(timeline.visits()).toBe(before);
    });
  });

  it("leaves out a snapshot of a page that has no Visit", async () => {
    expect(await packageOf([snapshot("snapshot_1", 10, idle)])).toBeNull();
  });

  describe("Visits", () => {
    const cartUrl = "http://shop.test/cart";
    const toCart: TimelineAddition = {
      kind: "visit",
      page: "page_1",
      url: cartUrl,
      cause: "navigate",
    };
    // After a cross-document navigation, Playwright prefixes the refs.
    const cart = [
      `- generic [ref=f1e1]:`,
      `  - heading "Cart" [level=1] [ref=f1e2]`,
      `  - button "Pay" [ref=f1e3]`,
    ].join("\n");

    it("writes an Interaction that leaves the page in its own Visit, with no Change Tree; the next Visit starts from the page it led to", async () => {
      const text = await packageOf([
        visit,
        snapshot("snapshot_1", 10, idle),
        toCart,
        snapshot("snapshot_2", 20, cart),
        click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
      ]);

      expect(text).toContain(
        [
          `  - visitId: visit_1`,
          `    url: http://shop.test/`,
          `    cause: initial`,
          `    baselineTree:`,
          `      - [ref=e1]:`,
          `        - [ref=e2] button "Save"`,
          `        - [ref=e3] paragraph: Not saved`,
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
          `  - visitId: visit_2`,
          `    url: http://shop.test/cart`,
          `    cause: navigate`,
          `    baselineTree:`,
          `      - [ref=f1e1]:`,
          `        - [ref=f1e2] heading "Cart" [level=1]`,
          `        - [ref=f1e3] button "Pay"`,
          `    timelineEntries: []`,
          `traceActionPoints: []`,
          ``,
        ].join("\n")
      );
    });

    // The cart page goes on rendering after it has loaded.
    const cartWithOffer = [
      `- generic [ref=f1e1]:`,
      `  - heading "Cart" [level=1] [ref=f1e2]`,
      `  - button "Pay" [ref=f1e3]`,
      `  - paragraph [ref=f1e4]: Free delivery today`,
    ].join("\n");
    const paid = cartWithOffer.replace(`"Pay"`, `"Paid" [disabled]`);
    const cartBaseline = [
      `    baselineTree:`,
      `      - [ref=f1e1]:`,
      `        - [ref=f1e2] heading "Cart" [level=1]`,
      `        - [ref=f1e3] button "Pay"`,
      `        - [ref=f1e4] paragraph: Free delivery today`,
    ].join("\n");
    const leaving = [
      visit,
      snapshot("snapshot_1", 10, idle),
      toCart,
      snapshot("snapshot_2", 20, cart),
      click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
    ];

    it("starts a Visit from the page as it stood just before its first Interaction: what it rendered before that is no change", async () => {
      const text = await packageOf([
        ...leaving,
        snapshot("snapshot_3", 30, cartWithOffer),
        snapshot("snapshot_4", 40, paid),
        click("snapshot_3", "snapshot_4", { ref: "f1e3", tree: cart }),
      ]);

      expect(text).toContain(
        [`    cause: navigate`, cartBaseline, `    timelineEntries:`].join("\n")
      );
      expect(text).not.toContain("kind: change");
    });

    it("starts a Visit without Interactions from the page as it stood at the end", async () => {
      const text = await packageOf([
        ...leaving,
        snapshot("snapshot_3", 30, cartWithOffer),
      ]);

      expect(text).toContain(
        [`    cause: navigate`, cartBaseline, `    timelineEntries: []`].join(
          "\n"
        )
      );
    });

    it("stays in the Visit when only the part of the address after '?' or '#' changes, as core decides", async () => {
      const text = await packageOf([
        visit,
        snapshot("snapshot_1", 10, idle),
        { ...toCart, url: "http://shop.test/?tab=saved#top" },
        snapshot("snapshot_2", 20, savedPage),
        click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
      ]);

      expect(text).not.toContain("visit_2");
      expect(text).toContain(
        `            - <changed> [ref=e3] paragraph: Saved`
      );
    });
  });
});

// Inputs the gate never holds, as typing: their "before" is the report's own
// picture of the page, matched to the snapshots around it.
describe("the timeline, for an input known from its report", () => {
  const draftEmpty = [
    `- generic [ref=e1]:`,
    `  - heading "Shopping" [level=1] [ref=e2]`,
    `  - textbox "Item" [ref=e3]`,
    `  - paragraph [ref=e4]: No draft`,
  ].join("\n");
  // Playwright's recorder numbers its picture by itself. When the person
  // typed, a banner was already there and the field showed the first key.
  const atTheMoment = [
    `- generic [ref=e1]:`,
    `  - heading "Shopping" [level=1] [ref=e2]`,
    `  - alert [ref=e3]: Welcome back`,
    `  - textbox "Item" [ref=e4]: m`,
    `  - paragraph [ref=e5]: No draft`,
  ].join("\n");
  const draftSaved = [
    `- generic [ref=e1]:`,
    `  - heading "Shopping" [level=1] [ref=e2]`,
    `  - alert [ref=e5]: Welcome back`,
    `  - textbox "Item" [ref=e3]: milk`,
    `  - paragraph [ref=e4]: Draft saved`,
  ].join("\n");
  const typing = (picture: string): TimelineAddition => ({
    kind: "interaction",
    interaction: {
      page: "page_1",
      report: {
        type: "fill",
        selector: 'internal:role=textbox[name="Item"i]',
        target: { ref: "e4", tree: picture },
        values: { text: "milk" },
      },
      before: "snapshot_1",
      after: "snapshot_2",
      at: 10,
      beforeFromReport: true,
    },
  });

  it("writes what changed before the input apart from what the input changed, as the report's picture tells", async () => {
    const timeline = new Timeline();
    for (const addition of [
      visit,
      snapshot("snapshot_1", 10, draftEmpty),
      snapshot("snapshot_2", 20, draftSaved),
      typing(atTheMoment),
    ])
      await timeline.add(addition);

    expect(await timeline.package(header)).toContain(
      [
        `    timelineEntries:`,
        `      - kind: change`,
        `        timestamp: 10`,
        `        changeTree:`,
        `          - [ref=e1]:`,
        `            - <added> [ref=e5] alert: Welcome back`,
        `      - kind: interaction`,
        `        timestamp: 10`,
        `        interaction:`,
        `          id: interaction_1`,
        `          type: fill`,
        `          targetRef: e3`,
        `          targetSelector: internal:role=textbox[name="Item"i]`,
        `          text: milk`,
        `        changeTree:`,
        `          - [ref=e1]:`,
        `            - <changed> [ref=e3] textbox "Item": milk`,
        `            - <changed> [ref=e4] paragraph: Draft saved`,
        `traceActionPoints: []`,
      ].join("\n")
    );
    expect(timeline.warnings()).toEqual([]);
  });

  it("writes the input with its 'after' only, and warns, when the report's picture is not of the shape of a snapshot", async () => {
    // Nodes the snapshots before and after agree on are missing from it.
    const otherShape = `- document [ref=e1]: Shopping Item No draft`;
    const timeline = new Timeline();
    for (const addition of [
      visit,
      snapshot("snapshot_1", 10, draftEmpty),
      snapshot("snapshot_2", 20, draftSaved),
      typing(otherShape),
    ])
      await timeline.add(addition);

    const text = await timeline.package(header);
    expect(text).not.toContain("kind: change");
    expect(text).toContain(
      [
        `        changeTree:`,
        `          - [ref=e1]:`,
        `            - <added> [ref=e5] alert: Welcome back`,
        `            - <changed> [ref=e3] textbox "Item": milk`,
        `            - <changed> [ref=e4] paragraph: Draft saved`,
        `traceActionPoints: []`,
      ].join("\n")
    );
    expect(timeline.warnings()).toEqual([
      {
        kind: "reportShape",
        message:
          "Playwright's report of interaction_1 does not have the shape of a snapshot: it is recorded with what it changed up to its 'after' only.",
      },
    ]);
  });
});

describe("the timeline, for a target the snapshot does not list", () => {
  const listed = [
    `- generic [ref=e5]:`,
    `  - generic [ref=e6]:`,
    `    - paragraph [ref=e7]: Not saved`,
  ].join("\n");
  const page = [
    `- generic [ref=e1]:`,
    `  - generic [ref=e2]:`,
    `    - paragraph [ref=e3]: Not saved`,
  ].join("\n");

  it("marks a click on its nearest ancestor that is listed, and keeps the selector of the real element", async () => {
    // The element clicked is a decoration with no role: Playwright's picture
    // does not list it, nor its parent, but its grandparent.
    const text = await packageOf([
      visit,
      snapshot("snapshot_1", 10, page),
      snapshot("snapshot_2", 20, page),
      {
        kind: "interaction",
        interaction: {
          page: "page_1",
          report: {
            type: "click",
            selector: "#star",
            target: { ref: null, ancestors: ["e99", "e6", "e5"], tree: listed },
            values: { clickCount: 1 },
          },
          before: "snapshot_1",
          after: "snapshot_2",
          at: 15,
        },
      },
    ]);

    expect(text).toContain(
      [
        `          type: click`,
        `          targetRef: e2`,
        `          targetSelector: "#star"`,
        ``,
      ].join("\n")
    );
  });

  it("writes a null target ref for a key pressed with nothing focused, and keeps its selector", async () => {
    const text = await packageOf([
      visit,
      snapshot("snapshot_1", 10, page),
      snapshot("snapshot_2", 20, page),
      {
        kind: "interaction",
        interaction: {
          page: "page_1",
          report: {
            type: "press",
            selector: "body",
            target: { ref: null, ancestors: [], tree: listed },
            values: { key: "Escape", modifiers: 0 },
          },
          before: "snapshot_1",
          after: "snapshot_2",
          at: 15,
        },
      },
    ]);

    expect(text).toContain(
      [
        `          type: press`,
        `          targetRef: null`,
        `          targetSelector: body`,
        `          modifiers: 0`,
        `          key: Escape`,
        ``,
      ].join("\n")
    );
  });
});

describe("the timeline, for an input inside a frame", () => {
  // The snapshot lists a same-origin frame's elements under its iframe;
  // Playwright's picture of an input in the frame is of the frame alone.
  const withFrame = (field: string, note: string) =>
    [
      `- generic [ref=e1]:`,
      `  - heading "Shop" [level=1] [ref=e2]`,
      `  - iframe [ref=e3]:`,
      `    - generic [ref=f1e1]:`,
      `      - textbox "Item" [ref=f1e2]${field}`,
      `      - button "Add" [ref=f1e3]`,
      `  - paragraph [ref=e4]: ${note}`,
    ].join("\n");
  const frameAlone = (field: string) =>
    [
      `- generic [ref=e7]:`,
      `  - textbox "Item" [ref=e8]${field}`,
      `  - button "Add" [ref=e9]`,
    ].join("\n");
  const inFrame = (
    type: string,
    ref: string,
    tree: string,
    beforeFromReport?: boolean
  ): TimelineAddition => ({
    kind: "interaction",
    interaction: {
      page: "page_1",
      report: {
        type,
        selector: `iframe >> internal:control=enter-frame >> ${type}`,
        target: { ref, tree },
        values: {},
      },
      before: "snapshot_1",
      after: "snapshot_2",
      at: 10,
      ...(beforeFromReport ? { beforeFromReport } : {}),
    },
  });

  it("finds a click's target among the frame's elements", async () => {
    const text = await packageOf([
      visit,
      snapshot("snapshot_1", 10, withFrame("", "Empty")),
      snapshot("snapshot_2", 20, withFrame("", "One item")),
      inFrame("click", "e9", frameAlone("")),
    ]);

    expect(text).toContain(`          targetRef: f1e3\n`);
  });

  it("takes typing's 'before' in the frame from the report's picture, and the rest of the page from the snapshot before it", async () => {
    const timeline = new Timeline();
    for (const addition of [
      visit,
      snapshot("snapshot_1", 10, withFrame("", "Empty")),
      snapshot("snapshot_2", 20, withFrame(": milk", "Draft saved")),
      inFrame("fill", "e8", frameAlone(": m"), true),
    ])
      await timeline.add(addition);

    expect(await timeline.package(header)).toContain(
      [
        `          targetRef: f1e2`,
        `          targetSelector: iframe >> internal:control=enter-frame >> fill`,
        `        changeTree:`,
        `          - [ref=e1]:`,
        `            - [ref=e3] iframe:`,
        `              - [ref=f1e1]:`,
        `                - <changed> [ref=f1e2] textbox "Item": milk`,
        `            - <changed> [ref=e4] paragraph: Draft saved`,
        `traceActionPoints: []`,
      ].join("\n")
    );
    expect(timeline.warnings()).toEqual([]);
  });
});

// Ticket #1279: leaving an entry out of the recording, and putting it back.
// An entry keeps its place in the timeline, marked; the package writes it as
// the released recorder does, a stub.
describe("the timeline, for discard and restore", () => {
  const banner = `${savedPage}\n  - alert [ref=e4]: Offer ends soon`;
  /** A click that saved, a change of the page's own, and a click that
   * changed nothing: `interaction_1`, `change_1`, `interaction_2`. */
  const flow: TimelineAddition[] = [
    visit,
    snapshot("snapshot_1", 10, idle),
    snapshot("snapshot_2", 20, savedPage),
    click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
    snapshot("snapshot_3", 30, banner),
    snapshot("snapshot_4", 40, banner),
    click("snapshot_3", "snapshot_4", { ref: "e2", tree: banner }),
  ];
  const timelineOf = async (additions: readonly TimelineAddition[]) => {
    const timeline = new Timeline();
    for (const addition of additions) await timeline.add(addition);
    return timeline;
  };
  const discard = (entry: string): TimelineAddition => ({
    kind: "discard",
    entry,
  });
  const restore = (entry: string): TimelineAddition => ({
    kind: "restore",
    entry,
  });

  it("gives every entry an identity that stays: an Interaction's, and a change's of its own", async () => {
    const timeline = await timelineOf(flow);

    expect(
      timeline.visits()[0]!.entries.map((entry) => [entry.kind, entry.id])
    ).toEqual([
      ["interaction", "interaction_1"],
      ["change", "change_1"],
      ["interaction", "interaction_2"],
    ]);
  });

  it("marks a discarded entry where it is, keeps the rest as it was, and puts it back", async () => {
    const timeline = await timelineOf(flow);
    const before = timeline.visits();

    await timeline.add(discard("interaction_1"));
    const [first, change, second] = timeline.visits()[0]!.entries;
    expect(first).toMatchObject({ id: "interaction_1", discarded: true });
    // What it changed is still there: the window hides it, and a restore
    // brings it back as it was.
    expect(first).toHaveProperty("changeTree");
    expect(change).not.toHaveProperty("discarded");
    expect(second).not.toHaveProperty("discarded");

    await timeline.add(restore("interaction_1"));
    expect(timeline.visits()).toEqual(before);
    expect(timeline.visits()[0]!.entries[0]).not.toHaveProperty("discarded");
  });

  it("discards a change of its own as well as an Interaction", async () => {
    const timeline = await timelineOf(flow);

    await timeline.add(discard("change_1"));

    expect(timeline.visits()[0]!.entries.map((entry) => entry.id)).toEqual([
      "interaction_1",
      "change_1",
      "interaction_2",
    ]);
    expect(timeline.visits()[0]!.entries[1]).toMatchObject({
      kind: "change",
      discarded: true,
    });
  });

  it("leaves what it does not have alone: the list is the same one", async () => {
    const timeline = await timelineOf(flow);
    const before = timeline.visits();

    await timeline.add(discard("interaction_9"));
    await timeline.add(restore("interaction_1"));

    expect(timeline.visits()).toBe(before);
  });

  it("writes a discarded entry as the released recorder does, a stub; the trace still has the Interaction's action", async () => {
    const timeline = await timelineOf(flow);
    await timeline.add(discard("interaction_1"));
    await timeline.add(discard("change_1"));

    expect(
      await timeline.package(header, { snapshot_1: "11", snapshot_3: "31" })
    ).toContain(
      [
        `    timelineEntries:`,
        `      - kind: interaction`,
        `        timestamp: 15`,
        `        discarded: true`,
        `        interaction:`,
        `          id: interaction_1`,
        `          type: click`,
        `      - kind: change`,
        `        timestamp: 30`,
        `        discarded: true`,
        `      - kind: interaction`,
        `        timestamp: 15`,
        `        interaction:`,
        `          id: interaction_2`,
        `          type: click`,
        `          targetRef: e2`,
        `          targetSelector: internal:role=button[name="Save"i]`,
        `          button: left`,
        `          modifiers: 0`,
        `          clickCount: 1`,
        `traceActionPoints:`,
        `  - interactionId: interaction_1`,
        `    pageId: page_1`,
        `    beforeSnapshotId: "11"`,
      ].join("\n")
    );
  });

  it("writes an entry that was discarded and restored as if it never was", async () => {
    const kept = await (await timelineOf(flow)).package(header);
    const timeline = await timelineOf(flow);
    await timeline.add(discard("interaction_1"));
    await timeline.add(restore("interaction_1"));

    expect(await timeline.package(header)).toBe(kept);
  });

  it("still has a package when every entry was discarded, unlike a recording of nothing", async () => {
    const timeline = await timelineOf(flow);
    for (const entry of ["interaction_1", "change_1", "interaction_2"])
      await timeline.add(discard(entry));

    const text = await timeline.package(header);

    expect(text).not.toBeNull();
    expect(text).not.toContain("changeTree:");
    expect(text!.match(/discarded: true/g)).toHaveLength(3);
    // Nothing was recorded here: that is empty, as before.
    expect(
      await (
        await timelineOf([visit, snapshot("snapshot_1", 10, idle)])
      ).package(header)
    ).toBeNull();
  });

  it("leaves the later Visit intact when the navigation that led to it is discarded", async () => {
    const cart = [
      `- generic [ref=f1e1]:`,
      `  - heading "Cart" [level=1] [ref=f1e2]`,
      `  - button "Pay" [ref=f1e3]`,
    ].join("\n");
    const paid = cart.replace(`"Pay"`, `"Paid" [disabled]`);
    const timeline = await timelineOf([
      visit,
      snapshot("snapshot_1", 10, idle),
      {
        kind: "visit",
        page: "page_1",
        url: "http://shop.test/cart",
        cause: "navigate",
      },
      snapshot("snapshot_2", 20, cart),
      click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
      snapshot("snapshot_3", 30, cart),
      snapshot("snapshot_4", 40, paid),
      click("snapshot_3", "snapshot_4", { ref: "f1e3", tree: cart }),
    ]);
    const visitsBefore = timeline.visits().map((one) => one.visitId);

    await timeline.add(discard("interaction_1"));

    expect(timeline.visits().map((one) => one.visitId)).toEqual(visitsBefore);
    expect(await timeline.package(header)).toContain(
      [
        `  - visitId: visit_2`,
        `    url: http://shop.test/cart`,
        `    cause: navigate`,
        `    baselineTree:`,
        `      - [ref=f1e1]:`,
        `        - [ref=f1e2] heading "Cart" [level=1]`,
        `        - [ref=f1e3] button "Pay"`,
        `    timelineEntries:`,
        `      - kind: interaction`,
        `        timestamp: 15`,
        `        interaction:`,
        `          id: interaction_2`,
        `          type: click`,
        `          targetRef: f1e3`,
      ].join("\n")
    );
  });
});

// Ticket #1278: an assertion is an entry like an Interaction, with one
// snapshot that is its "before" and its "after".
describe("the timeline, for an assertion", () => {
  const assertion = (snapshotId: string, at: number): TimelineAddition => ({
    kind: "interaction",
    interaction: {
      page: "page_1",
      report: {
        type: "assertVisible",
        selector: 'internal:role=paragraph >> internal:has-text="Saved"i',
        target: null,
        values: {},
      },
      before: snapshotId,
      after: snapshotId,
      at,
    },
  });

  it("writes an assertion with no Change Tree, and what changed since the last snapshot as a change before it (rule 7)", async () => {
    const text = await packageOf(
      [
        visit,
        snapshot("snapshot_1", 10, idle),
        snapshot("snapshot_2", 20, idle),
        click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
        snapshot("snapshot_3", 30, savedPage),
        assertion("snapshot_3", 30),
      ],
      { snapshot_1: "11", snapshot_2: "17", snapshot_3: "23" }
    );

    expect(text).toContain(
      [
        `          clickCount: 1`,
        `      - kind: change`,
        `        timestamp: 30`,
        `        changeTree:`,
        `          - [ref=e1]:`,
        `            - <changed> [ref=e3] paragraph: Saved`,
        `      - kind: interaction`,
        `        timestamp: 30`,
        `        interaction:`,
        `          id: interaction_2`,
        `          type: assertVisible`,
        `          targetRef: null`,
        `          targetSelector: internal:role=paragraph >> internal:has-text="Saved"i`,
        `traceActionPoints:`,
      ].join("\n")
    );
    expect(text).toContain(
      [
        `  - interactionId: interaction_2`,
        `    pageId: page_1`,
        `    beforeSnapshotId: "23"`,
        `    afterSnapshotId: "23"`,
        `    startedAt: 30`,
        `    endedAt: 30`,
      ].join("\n")
    );
  });

  it("starts a Visit whose first entry is an assertion with the page as it stood at the assertion", async () => {
    const text = await packageOf([
      visit,
      snapshot("snapshot_1", 10, idle),
      snapshot("snapshot_2", 20, savedPage),
      assertion("snapshot_2", 20),
    ]);

    expect(text).toContain(
      [
        `    baselineTree:`,
        `      - [ref=e1]:`,
        `        - [ref=e2] button "Save"`,
        `        - [ref=e3] paragraph: Saved`,
        `    timelineEntries:`,
        `      - kind: interaction`,
        `        timestamp: 20`,
      ].join("\n")
    );
    expect(text).not.toContain("changeTree");
  });
});

// Ticket #1278: where an entry's element is now, for the hover highlight.
describe("the timeline, for the highlight", () => {
  const recreated = [
    `- generic [ref=e1]:`,
    `  - button "Save" [ref=e8]`,
    `  - paragraph [ref=e3]: Saved`,
  ].join("\n");
  const without = [`- generic [ref=e1]:`, `  - paragraph [ref=e3]: Saved`].join(
    "\n"
  );
  async function timelineOf(additions: readonly TimelineAddition[]) {
    const timeline = new Timeline();
    for (const addition of additions) await timeline.add(addition);
    return timeline;
  }
  const clicked = [
    visit,
    snapshot("snapshot_1", 10, idle),
    snapshot("snapshot_2", 20, savedPage),
    click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
  ];

  it("finds an Interaction's target by the ref the page's latest snapshot gives it", async () => {
    const timeline = await timelineOf(clicked);

    expect(timeline.liveTarget("interaction_1")).toEqual({
      page: "page_1",
      ref: "e2",
      selector: 'internal:role=button[name="Save"i]',
    });
  });

  it("finds an element the page re-created by its ref now, not the first one the package keeps", async () => {
    const timeline = await timelineOf([
      ...clicked,
      snapshot("snapshot_3", 30, recreated),
    ]);

    expect(timeline.liveTarget("interaction_1")).toMatchObject({ ref: "e8" });
  });

  it("finds nothing for an element the latest snapshot no longer has", async () => {
    const timeline = await timelineOf([
      ...clicked,
      snapshot("snapshot_3", 30, without),
    ]);

    expect(timeline.liveTarget("interaction_1")).toBeNull();
  });

  it("finds nothing for an entry of an earlier Visit of its page", async () => {
    const timeline = await timelineOf([
      ...clicked,
      {
        kind: "visit",
        page: "page_1",
        url: "http://shop.test/cart",
        cause: "navigate",
      },
      snapshot("snapshot_3", 30, idle),
    ]);

    expect(timeline.liveTarget("interaction_1")).toBeNull();
  });

  it("finds a target with no ref by its selector, and nothing for an entry with neither, or none at all", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot("snapshot_1", 10, idle),
      snapshot("snapshot_2", 20, idle),
      click("snapshot_1", "snapshot_2", null),
      snapshot("snapshot_3", 30, savedPage),
    ]);

    expect(timeline.liveTarget("interaction_1")).toEqual({
      page: "page_1",
      ref: null,
      selector: 'internal:role=button[name="Save"i]',
    });
    expect(timeline.liveTarget("change_1")).toBeNull();
    expect(timeline.liveTarget("interaction_9")).toBeNull();
  });
});
