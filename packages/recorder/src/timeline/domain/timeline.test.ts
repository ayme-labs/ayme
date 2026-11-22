import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { TimelineAddition } from "./recorded";
import { Timeline, type PackageHeader } from "./timeline";
import type { EntryId } from "../../contract";
import type { SnapshotId } from "./recorded";
import { pictureRef, type PictureRef } from "./refs";
import {
  header,
  snapshot,
  timelineOf,
  url,
  visit,
} from "./test-utils/timelineBuilders";
import {
  entryId,
  pageId,
  snapshotId,
  snapshotRefOf,
  tracePositions,
} from "../../test-utils/ids";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const click = (
  before: SnapshotId,
  after: SnapshotId | null,
  target: { ref: PictureRef; tree: string } | null,
  selector: string | null = 'internal:role=button[name="Save"i]'
): TimelineAddition => ({
  kind: "interaction",
  interaction: {
    page: pageId("page_1"),
    report: {
      type: "click",
      selector,
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
  const timeline = await timelineOf(additions);
  return timeline.package(header, tracePositions(positions));
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
          snapshot(snapshotId("snapshot_1"), 10, idle),
          snapshot(snapshotId("snapshot_2"), 20, savedPage),
          click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
            ref: pictureRef("e2"),
            tree: idle,
          }),
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

    it("gives an Interaction that changed nothing the read it started at as its after too", async () => {
      const text = await packageOf(
        [
          visit,
          snapshot(snapshotId("snapshot_1"), 10, idle),
          click(snapshotId("snapshot_1"), snapshotId("snapshot_1"), {
            ref: pictureRef("e2"),
            tree: idle,
          }),
        ],
        { snapshot_1: "11" }
      );

      expect(text).toContain(
        [`    beforeSnapshotId: "11"`, `    afterSnapshotId: "11"`].join("\n")
      );
    });

    it("gives an Interaction that left its page a before and no after", async () => {
      const text = await packageOf(
        [
          visit,
          snapshot(snapshotId("snapshot_1"), 10, idle),
          click(snapshotId("snapshot_1"), null, {
            ref: pictureRef("e2"),
            tree: idle,
          }),
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
          snapshot(snapshotId("snapshot_1"), 10, idle),
          {
            kind: "visit",
            page: pageId("page_1"),
            url: `${url}cart`,
            cause: "navigate",
          },
          snapshot(snapshotId("snapshot_2"), 20, savedPage),
          click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
            ref: pictureRef("e2"),
            tree: idle,
          }),
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
          snapshot(snapshotId("snapshot_1"), 10, idle),
          snapshot(snapshotId("snapshot_2"), 20, savedPage),
          click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
            ref: pictureRef("e2"),
            tree: idle,
          }),
          click(snapshotId("snapshot_2"), null, {
            ref: pictureRef("e2"),
            tree: savedPage,
          }),
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
        snapshot(snapshotId("snapshot_1"), 10, idle),
        snapshot(snapshotId("snapshot_2"), 20, savedPage),
      ])
    ).toBeNull();
  });

  it("writes a Visit without Interactions, beside one that has one, with its first snapshot and no entries", async () => {
    const text = await packageOf([
      visit,
      {
        kind: "visit",
        page: pageId("page_2"),
        url: `${url}help`,
        cause: "openPage",
      },
      snapshot(snapshotId("snapshot_1"), 10, idle),
      {
        kind: "snapshot",
        snapshot: {
          id: snapshotId("snapshot_2"),
          page: pageId("page_2"),
          url: `${url}help`,
          at: 11,
          tree: idle,
        },
      },
      click(snapshotId("snapshot_1"), null, null),
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
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, savedPage),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: idle,
      }),
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
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, savedPage),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e7"),
        tree: reportsPicture,
      }),
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
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, savedPage),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: otherPage,
      }),
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
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, savedPage),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), null),
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
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, recreated),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: idle,
      }),
      snapshot(snapshotId("snapshot_3"), 30, savedTwice),
      click(snapshotId("snapshot_2"), snapshotId("snapshot_3"), {
        ref: pictureRef("e8"),
        tree: recreated,
      }),
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
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, savedPage),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: idle,
      }),
      snapshot(snapshotId("snapshot_3"), 30, banner),
      snapshot(snapshotId("snapshot_4"), 40, bannerAndCount),
      click(snapshotId("snapshot_3"), snapshotId("snapshot_4"), {
        ref: pictureRef("e2"),
        tree: banner,
      }),
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
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, idle),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: idle,
      }),
      snapshot(snapshotId("snapshot_3"), 30, savedPage),
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
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, idle),
      snapshot(snapshotId("snapshot_3"), 30, idle),
      click(snapshotId("snapshot_2"), snapshotId("snapshot_3"), null),
    ]);

    expect(text).toContain("kind: interaction");
    expect(text).not.toContain("kind: change");
    expect(text).not.toContain("changeTree");
  });

  it("gives an Interaction whose page was gone before its 'after' no Change Tree", async () => {
    const text = await packageOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, idle),
      click(snapshotId("snapshot_1"), null, {
        ref: pictureRef("e2"),
        tree: idle,
      }),
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
      id: entryId("interaction_1"),
      timestamp: 15,
      interaction: {
        id: entryId("interaction_1"),
        type: "click",
        targetRef: "e2",
        targetSelector: 'internal:role=button[name="Save"i]',
        button: "left",
        modifiers: 0,
        clickCount: 1,
      },
      targetElement: 'button "Save"',
      changes: [
        {
          kind: "changed",
          element: 'paragraph "Saved"',
          changed: [{ property: "text", from: "Not saved", to: "Saved" }],
        },
      ],
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
      await timeline.add(snapshot(snapshotId("snapshot_1"), 10, idle));
      await timeline.add(snapshot(snapshotId("snapshot_2"), 20, savedPage));
      expect(timeline.visits()).toEqual(visitWith([]));

      await timeline.add(
        click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
          ref: pictureRef("e2"),
          tree: idle,
        })
      );

      expect(timeline.visits()).toEqual(visitWith([savedByClick]));
    });

    it("has a change of no Interaction with the next Interaction, and one after the last when the package is made", async () => {
      const banner = `${savedPage}\n  - alert [ref=e4]: Offer ends soon`;
      const timeline = new Timeline();
      await timeline.add(visit);
      await timeline.add(snapshot(snapshotId("snapshot_1"), 10, idle));
      await timeline.add(snapshot(snapshotId("snapshot_2"), 20, savedPage));
      await timeline.add(
        click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
          ref: pictureRef("e2"),
          tree: idle,
        })
      );
      await timeline.add(snapshot(snapshotId("snapshot_3"), 30, banner));
      await timeline.add(snapshot(snapshotId("snapshot_4"), 40, banner));
      expect(timeline.visits()).toEqual(visitWith([savedByClick]));

      await timeline.add(
        click(snapshotId("snapshot_3"), snapshotId("snapshot_4"), {
          ref: pictureRef("e2"),
          tree: banner,
        })
      );
      const offer = {
        kind: "change",
        id: entryId("change_1"),
        timestamp: 30,
        changes: [{ kind: "added", element: 'alert "Offer ends soon"' }],
      };
      const secondClick = {
        kind: "interaction",
        id: entryId("interaction_2"),
        timestamp: 15,
        interaction: {
          ...savedByClick.interaction,
          id: entryId("interaction_2"),
        },
        targetElement: 'button "Save"',
        // It changed nothing.
        changes: null,
      };
      expect(timeline.visits()).toEqual(
        visitWith([savedByClick, offer, secondClick])
      );

      await timeline.add(snapshot(snapshotId("snapshot_5"), 50, idle));
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
      await timeline.add(snapshot(snapshotId("snapshot_1"), 10, idle));

      expect(timeline.visits()).toBe(before);
    });
  });

  it("leaves out a snapshot of a page that has no Visit", async () => {
    expect(
      await packageOf([snapshot(snapshotId("snapshot_1"), 10, idle)])
    ).toBeNull();
  });

  describe("Visits", () => {
    const cartUrl = "http://shop.test/cart";
    const toCart: TimelineAddition = {
      kind: "visit",
      page: pageId("page_1"),
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
        snapshot(snapshotId("snapshot_1"), 10, idle),
        toCart,
        snapshot(snapshotId("snapshot_2"), 20, cart),
        click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
          ref: pictureRef("e2"),
          tree: idle,
        }),
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
      snapshot(snapshotId("snapshot_1"), 10, idle),
      toCart,
      snapshot(snapshotId("snapshot_2"), 20, cart),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: idle,
      }),
    ];

    it("starts a Visit from the page as it stood just before its first Interaction: what it rendered before that is no change", async () => {
      const text = await packageOf([
        ...leaving,
        snapshot(snapshotId("snapshot_3"), 30, cartWithOffer),
        snapshot(snapshotId("snapshot_4"), 40, paid),
        click(snapshotId("snapshot_3"), snapshotId("snapshot_4"), {
          ref: pictureRef("f1e3"),
          tree: cart,
        }),
      ]);

      expect(text).toContain(
        [`    cause: navigate`, cartBaseline, `    timelineEntries:`].join("\n")
      );
      expect(text).not.toContain("kind: change");
    });

    it("starts a Visit without Interactions from the page as it stood at the end", async () => {
      const text = await packageOf([
        ...leaving,
        snapshot(snapshotId("snapshot_3"), 30, cartWithOffer),
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
        snapshot(snapshotId("snapshot_1"), 10, idle),
        { ...toCart, url: "http://shop.test/?tab=saved#top" },
        snapshot(snapshotId("snapshot_2"), 20, savedPage),
        click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
          ref: pictureRef("e2"),
          tree: idle,
        }),
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
      page: pageId("page_1"),
      report: {
        type: "fill",
        selector: 'internal:role=textbox[name="Item"i]',
        target: { ref: pictureRef("e4"), tree: picture },
        values: { text: "milk" },
      },
      before: snapshotId("snapshot_1"),
      after: snapshotId("snapshot_2"),
      at: 10,
      beforeFromReport: true,
    },
  });

  it("writes what changed before the input apart from what the input changed, as the report's picture tells", async () => {
    const timeline = new Timeline();
    for (const addition of [
      visit,
      snapshot(snapshotId("snapshot_1"), 10, draftEmpty),
      snapshot(snapshotId("snapshot_2"), 20, draftSaved),
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
      snapshot(snapshotId("snapshot_1"), 10, draftEmpty),
      snapshot(snapshotId("snapshot_2"), 20, draftSaved),
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

  describe("while it is typed, added under a key", () => {
    /** The typing, added under its key, with its text and latest read. */
    const typed = (
      text: string,
      after: SnapshotId | null,
      picture = atTheMoment
    ): TimelineAddition => {
      const { interaction } = typing(picture) as Extract<
        TimelineAddition,
        { kind: "interaction" }
      >;
      return {
        kind: "interaction",
        key: "fill_1",
        interaction: {
          ...interaction,
          report: { ...interaction.report, values: { text } },
          after,
        },
      };
    };
    const entriesOf = (timeline: Timeline) =>
      timeline.visits().flatMap((one) => one.entries);
    const earlier = [visit, snapshot(snapshotId("snapshot_1"), 10, draftEmpty)];

    it("shows a fill as soon as it is added, before the page is read again: its text, what had changed by its first key as a row of its own, and no changes yet (rules 1, 3, 4)", async () => {
      const timeline = await timelineOf([...earlier, typed("m", null)]);

      expect(entriesOf(timeline)).toEqual([
        {
          kind: "change",
          id: entryId("change_1"),
          timestamp: 10,
          changes: [{ kind: "added", element: 'alert "Welcome back"' }],
        },
        expect.objectContaining({
          kind: "interaction",
          id: entryId("interaction_1"),
          // Its field is known from the picture already.
          interaction: expect.objectContaining({
            type: "fill",
            text: "m",
            targetRef: "e3",
          }),
          targetElement: 'textbox "Item"',
          changes: null,
        }),
      ]);
    });

    it("replaces a fill added again under its key in place: its text follows, its changes run from the picture at its first key to its latest read, and the row above it keeps its place (rules 1, 2, 4, 7)", async () => {
      const timeline = await timelineOf([...earlier, typed("m", null)]);
      const before = entriesOf(timeline);
      for (const addition of [
        snapshot(snapshotId("snapshot_2"), 20, draftSaved),
        typed("milk", snapshotId("snapshot_2")),
      ])
        await timeline.add(addition);

      const after = entriesOf(timeline);
      expect(after.map((entry) => entry.id)).toEqual(
        before.map((entry) => entry.id)
      );
      // The row of what changed before it keeps its place and id; its words
      // may follow what a later read tells.
      expect(after[0]).toMatchObject({ kind: "change", id: before[0]!.id });
      expect(after[1]).toMatchObject({
        interaction: { text: "milk" },
        changes: [
          {
            kind: "changed",
            element: 'textbox "Item"',
            changed: [{ property: "text" }],
          },
          {
            kind: "changed",
            element: 'paragraph "Draft saved"',
            changed: [{ property: "text" }],
          },
        ],
      });
    });

    it("names an element the page added before the first key by the later read's ref once that read comes, in the package as in the rows (rule 4)", async () => {
      const timeline = await timelineOf([...earlier, typed("m", null)]);
      for (const addition of [
        snapshot(snapshotId("snapshot_2"), 20, draftSaved),
        typed("milk", snapshotId("snapshot_2")),
      ])
        await timeline.add(addition);

      expect(await timeline.package(header)).toContain(
        [
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
    });

    it("leaves the list as it was when a fill is added again with nothing new, as its final write after its last update", async () => {
      const timeline = await timelineOf([
        ...earlier,
        snapshot(snapshotId("snapshot_2"), 20, draftSaved),
        typed("milk", snapshotId("snapshot_2")),
      ]);
      const before = timeline.visits();
      await timeline.add(typed("milk", snapshotId("snapshot_2")));

      expect(timeline.visits()).toBe(before);
    });

    it("replaces only the text of a fill when Playwright revises it after it could change no more (rule 5)", async () => {
      const timeline = await timelineOf([
        ...earlier,
        snapshot(snapshotId("snapshot_2"), 20, draftSaved),
        typed("milk", snapshotId("snapshot_2")),
      ]);
      const [, fill] = entriesOf(timeline);
      await timeline.add({
        kind: "text",
        key: "fill_1",
        report: {
          type: "fill",
          selector: 'internal:role=textbox[name="Item"i]',
          target: null,
          values: { text: "milky" },
        },
      });

      const [, now] = entriesOf(timeline);
      if (fill?.kind !== "interaction") throw new Error("No fill.");
      expect(now).toEqual({
        ...fill,
        interaction: { ...fill.interaction, text: "milky" },
      });
    });

    it("keeps the rows a fill showed from the last read of its own page when its typing makes the page go elsewhere", async () => {
      const timeline = await timelineOf([
        ...earlier,
        snapshot(snapshotId("snapshot_2"), 20, draftSaved),
        typed("milk", snapshotId("snapshot_2")),
      ]);
      const [, shown] = timeline.visits()[0]!.entries;
      // The last key submits the form: the page goes elsewhere, and the
      // fill's next read is of the page it went to.
      for (const addition of [
        {
          kind: "visit",
          page: pageId("page_1"),
          url: "http://shop.test/next",
          cause: "navigate",
        } as TimelineAddition,
        snapshot(snapshotId("snapshot_3"), 30, draftEmpty),
        typed("milk!", snapshotId("snapshot_3")),
      ])
        await timeline.add(addition);

      const [, fill] = timeline.visits()[0]!.entries;
      expect(fill).toMatchObject({
        interaction: { text: "milk!" },
        changes: shown!.kind === "interaction" ? shown!.changes : null,
      });
      expect((fill as { changes: unknown }).changes).not.toBeNull();
    });

    it("keeps a fill whose page went on to another Visit with what had changed by its first key, and no changes (rule 7)", async () => {
      const timeline = await timelineOf([
        ...earlier,
        typed("m", null),
        {
          kind: "visit",
          page: pageId("page_1"),
          url: "http://shop.test/next",
          cause: "navigate",
        },
        snapshot(snapshotId("snapshot_2"), 20, draftSaved),
        typed("milk", snapshotId("snapshot_2")),
      ]);

      const [first] = timeline.visits();
      expect(first!.entries).toEqual([
        expect.objectContaining({ kind: "change", id: entryId("change_1") }),
        expect.objectContaining({
          id: entryId("interaction_1"),
          interaction: expect.objectContaining({ text: "milk" }),
          changes: null,
        }),
      ]);
      expect(await timeline.package(header)).toContain("<added> [ref=s_");
    });

    it("keeps the row of what had changed by the first key in its place when a later read names its elements, after the entries before it", async () => {
      const timeline = await timelineOf([
        ...earlier,
        click(snapshotId("snapshot_1"), snapshotId("snapshot_1"), null),
        typed("m", null),
        snapshot(snapshotId("snapshot_2"), 20, draftSaved),
        typed("milk", snapshotId("snapshot_2")),
      ]);

      expect(entriesOf(timeline)).toEqual([
        expect.objectContaining({
          kind: "interaction",
          id: entryId("interaction_1"),
        }),
        expect.objectContaining({
          id: entryId("change_1"),
          changes: [{ kind: "added", element: 'alert "Welcome back"' }],
        }),
        expect.objectContaining({ id: entryId("interaction_2") }),
      ]);
      expect(await traceOf(timeline)).toContain(
        [
          `  - interactionId: interaction_2`,
          `    pageId: page_1`,
          `    beforeSnapshotId: "1"`,
          `    afterSnapshotId: "2"`,
        ].join("\n")
      );
    });

    it("keeps the ref of an element only the moment of the first key showed once the page is read again", async () => {
      // Two elements the first read lacks: the next read has the status, but
      // the alert was gone by then.
      const moment = [
        `- generic [ref=e1]:`,
        `  - heading "Shopping" [level=1] [ref=e2]`,
        `  - status [ref=e6]: Online`,
        `  - alert [ref=e3]: Welcome back`,
        `  - textbox "Item" [ref=e4]: m`,
        `  - paragraph [ref=e5]: No draft`,
      ].join("\n");
      const online = [
        `- generic [ref=e1]:`,
        `  - heading "Shopping" [level=1] [ref=e2]`,
        `  - status [ref=e7]: Online`,
        `  - textbox "Item" [ref=e3]: milk`,
        `  - paragraph [ref=e4]: No draft`,
      ].join("\n");
      const timeline = await timelineOf([...earlier, typed("m", null, moment)]);
      const shown = (await timeline.package(header))!;
      await timeline.add(snapshot(snapshotId("snapshot_2"), 20, online));
      await timeline.add(typed("milk", snapshotId("snapshot_2"), moment));

      const ref = (text: string) =>
        /<added> \[ref=([^\]]+)\] alert/.exec(text)?.[1];
      const now = (await timeline.package(header))!;
      expect(ref(now)).toBe(ref(shown));
      // The status is named as the next read names it.
      expect(now).toContain("<added> [ref=e7] status: Online");
    });

    it("keeps a fill whose picture fits its first read but not that read and the next together, as it was shown", async () => {
      // The picture misses the paragraph: it is taken as gone by the first
      // key while only the first read is known; the next read still has it.
      const missing = [
        `- generic [ref=e1]:`,
        `  - heading "Shopping" [level=1] [ref=e2]`,
        `  - alert [ref=e3]: Welcome back`,
        `  - textbox "Item" [ref=e4]: m`,
      ].join("\n");
      const timeline = await timelineOf([
        ...earlier,
        typed("m", null, missing),
      ]);
      await timeline.add(snapshot(snapshotId("snapshot_2"), 20, draftSaved));
      await timeline.add(typed("milk", snapshotId("snapshot_2"), missing));

      expect(entriesOf(timeline)).toEqual([
        expect.objectContaining({ id: entryId("change_1") }),
        expect.objectContaining({
          id: entryId("interaction_1"),
          interaction: expect.objectContaining({ text: "milk" }),
        }),
      ]);
    });

    /** The trace points of a timeline, every read at the place its number
     * says. */
    const traceOf = async (timeline: Timeline) => {
      const text = (await timeline.package(
        header,
        tracePositions({ snapshot_1: "1", snapshot_2: "2", snapshot_3: "3" })
      ))!;
      return text.slice(text.indexOf("traceActionPoints:"));
    };

    it("tells the trace a fill added again under its key ends at its latest read", async () => {
      const timeline = await timelineOf([
        ...earlier,
        typed("m", null),
        snapshot(snapshotId("snapshot_2"), 20, draftSaved),
        typed("milk", snapshotId("snapshot_2")),
        snapshot(snapshotId("snapshot_3"), 30, draftSaved),
        typed("milky", snapshotId("snapshot_3")),
      ]);

      expect(await traceOf(timeline)).toBe(
        [
          `traceActionPoints:`,
          `  - interactionId: interaction_1`,
          `    pageId: page_1`,
          `    beforeSnapshotId: "1"`,
          `    afterSnapshotId: "3"`,
          `    startedAt: 10`,
          `    endedAt: 30`,
          ``,
        ].join("\n")
      );
    });

    it("tells the trace a fill ends at the last read of its own page when its typing makes the page go elsewhere", async () => {
      const timeline = await timelineOf([
        ...earlier,
        snapshot(snapshotId("snapshot_2"), 20, draftSaved),
        typed("milk", snapshotId("snapshot_2")),
        {
          kind: "visit",
          page: pageId("page_1"),
          url: "http://shop.test/next",
          cause: "navigate",
        },
        snapshot(snapshotId("snapshot_3"), 30, draftEmpty),
        typed("milk!", snapshotId("snapshot_3")),
      ]);

      expect(await traceOf(timeline)).toContain(
        [
          `    beforeSnapshotId: "1"`,
          `    afterSnapshotId: "2"`,
          `    startedAt: 10`,
          `    endedAt: 20`,
        ].join("\n")
      );
    });

    it("tells the trace a fill whose page went on to another Visit before it was read again has no after in its Visit, and ends at the read it went on to (rule 7)", async () => {
      const timeline = await timelineOf([
        ...earlier,
        typed("m", null),
        {
          kind: "visit",
          page: pageId("page_1"),
          url: "http://shop.test/next",
          cause: "navigate",
        },
        snapshot(snapshotId("snapshot_2"), 20, draftSaved),
        typed("milk", snapshotId("snapshot_2")),
      ]);

      expect(await traceOf(timeline)).toBe(
        [
          `traceActionPoints:`,
          `  - interactionId: interaction_1`,
          `    pageId: page_1`,
          `    beforeSnapshotId: "1"`,
          `    startedAt: 10`,
          `    endedAt: 20`,
          ``,
        ].join("\n")
      );
    });

    it("leaves the list as it was when a fill added again is added once more with nothing new", async () => {
      const timeline = await timelineOf([
        ...earlier,
        typed("m", null),
        snapshot(snapshotId("snapshot_2"), 20, draftSaved),
        typed("milk", snapshotId("snapshot_2")),
      ]);
      const before = timeline.visits();
      await timeline.add(typed("milk", snapshotId("snapshot_2")));

      expect(timeline.visits()).toBe(before);
    });

    it("replaces a fill that is the first entry of its Visit, when nothing had changed by its first key", async () => {
      const unchanged = [
        `- generic [ref=e1]:`,
        `  - heading "Shopping" [level=1] [ref=e2]`,
        `  - textbox "Item" [ref=e4]: m`,
        `  - paragraph [ref=e5]: No draft`,
      ].join("\n");
      const timeline = await timelineOf([
        ...earlier,
        typed("m", null, unchanged),
      ]);
      await timeline.add(snapshot(snapshotId("snapshot_2"), 20, draftSaved));
      await timeline.add(typed("milk", snapshotId("snapshot_2"), unchanged));

      expect(entriesOf(timeline)).toEqual([
        expect.objectContaining({
          id: entryId("interaction_1"),
          interaction: expect.objectContaining({ text: "milk" }),
        }),
      ]);
    });

    it("keeps a fill the person left out left out when it is added again under its key", async () => {
      const timeline = await timelineOf([
        ...earlier,
        typed("m", null),
        { kind: "discard", entry: entryId("interaction_1") },
        snapshot(snapshotId("snapshot_2"), 20, draftSaved),
        typed("milk", snapshotId("snapshot_2")),
      ]);

      expect(entriesOf(timeline)[1]).toMatchObject({
        interaction: { text: "milk" },
        discarded: true,
      });
    });

    it("ignores a new text for a key no fill was added under", async () => {
      const timeline = await timelineOf([...earlier, typed("m", null)]);
      const before = timeline.visits();
      await timeline.add({
        kind: "text",
        key: "fill_9",
        report: {
          type: "fill",
          selector: 'internal:role=textbox[name="Item"i]',
          target: null,
          values: { text: "x" },
        },
      });

      expect(timeline.visits()).toBe(before);
    });

    it("writes no change twice when a fill is added again after an input that followed it was written", async () => {
      const sent = draftSaved.replace("Draft saved", "Draft sent");
      const done = draftSaved.replace("Draft saved", "Done");
      const timeline = await timelineOf([
        ...earlier,
        snapshot(snapshotId("snapshot_2"), 20, draftSaved),
        typed("milk", snapshotId("snapshot_2")),
        snapshot(snapshotId("snapshot_3"), 30, sent),
        click(snapshotId("snapshot_2"), snapshotId("snapshot_3"), null),
      ]);
      // Playwright's final write of the fill, with its last word.
      await timeline.add(typed("milk!", snapshotId("snapshot_2")));
      await timeline.add(snapshot(snapshotId("snapshot_4"), 40, done));
      await timeline.add(
        click(snapshotId("snapshot_3"), snapshotId("snapshot_4"), null)
      );

      expect(entriesOf(timeline).map((entry) => entry.id)).toEqual([
        entryId("change_1"),
        entryId("interaction_1"),
        entryId("interaction_2"),
        entryId("interaction_3"),
      ]);
    });
  });
});

describe("the timeline, for the focus a click's press moved", () => {
  // The press of a click reaches the page before the gate holds the click,
  // so the read taken just before the click already shows the clicked
  // element focused.
  const searching = [
    `- generic [ref=e1]:`,
    `  - textbox "Search" [active] [ref=e2]`,
    `  - link "ayme" [ref=e3]`,
    `  - paragraph [ref=e4]: Nothing loaded`,
  ].join("\n");
  const pressed = [
    `- generic [ref=e1]:`,
    `  - textbox "Search" [ref=e2]`,
    `  - link "ayme" [active] [ref=e3]`,
    `  - paragraph [ref=e4]: Banner loaded`,
  ].join("\n");
  const opened = [
    `- generic [ref=e1]:`,
    `  - textbox "Search" [ref=e2]`,
    `  - link "ayme" [active] [ref=e3]`,
    `  - paragraph [ref=e4]: Repository opened`,
  ].join("\n");
  const clickOn = (
    tree: string,
    selector = 'internal:role=link[name="ayme"s]'
  ): TimelineAddition => ({
    kind: "interaction",
    interaction: {
      page: pageId("page_1"),
      report: {
        type: "click",
        selector,
        target: { ref: pictureRef("e3"), tree },
        values: { button: "left", clickCount: 1 },
      },
      before: snapshotId("snapshot_2"),
      after: snapshotId("snapshot_3"),
      at: 20,
    },
  });
  const recorded = (target: string) => [
    visit,
    snapshot(snapshotId("snapshot_1"), 10, searching),
    // An Interaction before, so that the read before the click is not the
    // Visit's start.
    {
      kind: "interaction",
      interaction: {
        page: pageId("page_1"),
        report: {
          type: "click",
          selector: 'internal:role=textbox[name="Search"s]',
          target: { ref: pictureRef("e2"), tree: searching },
          values: { button: "left", clickCount: 1 },
        },
        before: snapshotId("snapshot_1"),
        after: snapshotId("snapshot_1"),
        at: 10,
      },
    } as TimelineAddition,
    snapshot(snapshotId("snapshot_2"), 20, pressed),
    snapshot(snapshotId("snapshot_3"), 30, opened),
    clickOn(target),
  ];

  it("shows the focus a click's press moved with the click, also when the click directly follows a step that ends where it starts, as typing does: the typing keeps its own changes", async () => {
    const typed = [
      `- generic [ref=e1]:`,
      `  - textbox "Search" [ref=e2]: ayme`,
      `  - link "ayme" [active] [ref=e3]`,
      `  - paragraph [ref=e4]: Nothing loaded`,
    ].join("\n");
    const clicked = [
      `- generic [ref=e1]:`,
      `  - textbox "Search" [ref=e2]: ayme`,
      `  - link "ayme" [active] [ref=e3]`,
      `  - paragraph [ref=e4]: Repository opened`,
    ].join("\n");
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, searching),
      // The typing ends where the click starts: one read is both.
      snapshot(snapshotId("snapshot_2"), 20, typed),
      {
        kind: "interaction",
        interaction: {
          page: pageId("page_1"),
          report: {
            type: "fill",
            selector: 'internal:role=textbox[name="Search"s]',
            target: { ref: pictureRef("e2"), tree: searching },
            values: { text: "ayme" },
          },
          before: snapshotId("snapshot_1"),
          after: snapshotId("snapshot_2"),
          at: 15,
          beforeFromReport: true,
        },
      },
      snapshot(snapshotId("snapshot_3"), 30, clicked),
      {
        kind: "interaction",
        interaction: {
          page: pageId("page_1"),
          report: {
            type: "click",
            selector: 'internal:role=link[name="ayme"s]',
            target: { ref: pictureRef("e3"), tree: typed },
            values: { button: "left", clickCount: 1 },
          },
          before: snapshotId("snapshot_2"),
          after: snapshotId("snapshot_3"),
          at: 20,
        },
      },
    ]);
    const [fill, click] = timeline.visits().flatMap((one) => one.entries);

    expect(fill).toMatchObject({
      interaction: { type: "fill" },
      changes: [
        {
          element: 'textbox "Search"',
          changed: [expect.objectContaining({ property: "text" })],
        },
      ],
    });
    expect(click).toMatchObject({
      interaction: { type: "click" },
      changes: expect.arrayContaining([
        expect.objectContaining({ element: 'textbox "Search"' }),
        expect.objectContaining({ element: 'link "ayme"' }),
      ]),
    });
  });

  it("keeps the focus a click's press moved out of a fill added again under its key, as one written once", async () => {
    // A banner came before the first key: a row of its own ahead of the
    // fill.
    const atFirstKey = searching.replace(
      "  - paragraph",
      "  - alert [ref=e9]: Welcome\n  - paragraph"
    );
    const typed = [
      `- generic [ref=e1]:`,
      `  - textbox "Search" [ref=e2]: ayme`,
      `  - link "ayme" [active] [ref=e3]`,
      `  - alert [ref=e5]: Welcome`,
      `  - paragraph [ref=e4]: Nothing loaded`,
    ].join("\n");
    const clicked = typed.replace("Nothing loaded", "Repository opened");
    const fill = (
      text: string,
      after: SnapshotId | null
    ): TimelineAddition => ({
      kind: "interaction",
      key: "fill_1",
      interaction: {
        page: pageId("page_1"),
        report: {
          type: "fill",
          selector: 'internal:role=textbox[name="Search"s]',
          target: { ref: pictureRef("e2"), tree: atFirstKey },
          values: { text },
        },
        before: snapshotId("snapshot_1"),
        after,
        at: 15,
        beforeFromReport: true,
      },
    });
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, searching),
      fill("a", null),
      snapshot(snapshotId("snapshot_2"), 20, typed),
      fill("ayme", snapshotId("snapshot_2")),
      snapshot(snapshotId("snapshot_3"), 30, clicked),
      {
        kind: "interaction",
        interaction: {
          page: pageId("page_1"),
          report: {
            type: "click",
            selector: 'internal:role=link[name="ayme"s]',
            target: { ref: pictureRef("e3"), tree: typed },
            values: { button: "left", clickCount: 1 },
          },
          before: snapshotId("snapshot_2"),
          after: snapshotId("snapshot_3"),
          at: 20,
        },
      },
    ]);
    const [banner, written] = timeline.visits().flatMap((one) => one.entries);

    expect(banner).toMatchObject({ kind: "change" });
    expect((written as { changes: unknown }).changes).toEqual([
      expect.objectContaining({ element: 'textbox "Search"' }),
    ]);
    // Its final write, with nothing new, leaves the list as it was.
    const shown = timeline.visits();
    await timeline.add(fill("ayme", snapshotId("snapshot_2")));
    expect(timeline.visits()).toBe(shown);
  });

  it("shows the clicked element gaining focus, and the one before losing it, with the click's own changes; what else changed before it stays a row of its own", async () => {
    const timeline = await timelineOf(recorded(pressed));
    const entries = timeline.visits().flatMap((one) => one.entries);
    const [, before, click] = entries;

    expect(before).toMatchObject({
      kind: "change",
      changes: [
        { kind: "changed", element: expect.stringContaining("paragraph") },
      ],
    });
    expect(click).toMatchObject({
      kind: "interaction",
      changes: expect.arrayContaining([
        expect.objectContaining({ element: 'textbox "Search"' }),
        expect.objectContaining({ element: 'link "ayme"' }),
      ]),
    });
    expect(entries).toHaveLength(3);
    expect((click as { changes: unknown }).changes).toEqual([
      focus('textbox "Search"', "lost"),
      focus('link "ayme"', "gained"),
      opening,
    ]);
  });

  /** A row of an element that gained or lost the focus. */
  const focus = (element: string, how: "gained" | "lost") => ({
    kind: "changed",
    element,
    changed: [
      {
        property: "active",
        ...(how === "gained" ? { to: "true" } : { from: "true" }),
      },
    ],
  });
  const opening = {
    kind: "changed",
    element: 'paragraph "Repository opened"',
    changed: [
      { property: "text", from: "Banner loaded", to: "Repository opened" },
    ],
  };
  /** The entries of `recorded`, with the read before the input and the
   * input changed as given. */
  const entriesWith = async (options: {
    first?: string;
    second?: string;
    third?: string;
    type?: string;
    target?: string;
    /** Known from Playwright's report alone: the gate never held it. */
    reported?: boolean;
    /** The input before ends at the read before this one. */
    priorEndsThere?: boolean;
    /** The read the input starts at is where recording resumed. */
    resumes?: boolean;
  }) => {
    const second = options.second ?? pressed;
    const additions = recorded(second).map((addition): TimelineAddition => {
      if (addition.kind === "snapshot") {
        if (addition.snapshot.id === snapshotId("snapshot_1"))
          return snapshot(
            snapshotId("snapshot_1"),
            10,
            options.first ?? searching
          );
        if (addition.snapshot.id === snapshotId("snapshot_2"))
          return {
            ...snapshot(snapshotId("snapshot_2"), 20, second),
            ...(options.resumes && { resumes: true }),
          };
        return snapshot(snapshotId("snapshot_3"), 30, options.third ?? opened);
      }
      if (
        addition.kind === "interaction" &&
        addition.interaction.before === snapshotId("snapshot_1")
      )
        return options.priorEndsThere
          ? {
              ...addition,
              interaction: {
                ...addition.interaction,
                after: snapshotId("snapshot_2"),
              },
            }
          : addition;
      if (addition.kind === "interaction")
        return {
          ...addition,
          interaction: {
            ...addition.interaction,
            ...(options.reported && { beforeFromReport: true }),
            report: {
              ...addition.interaction.report,
              type: options.type ?? "click",
              selector:
                options.target === "e4"
                  ? "internal:role=paragraph"
                  : 'internal:role=link[name="ayme"s]',
              target: {
                ref: pictureRef(options.target ?? "e3"),
                tree: second,
              },
            },
          },
        };
      return addition;
    });
    // An input is added once the read it ends at is taken.
    if (options.priorEndsThere)
      additions.splice(3, 0, ...additions.splice(2, 1));
    const timeline = await timelineOf(additions);
    return timeline.visits().flatMap((one) => one.entries);
  };
  const changesOf = (entry: unknown) => (entry as { changes: unknown }).changes;

  it.each(["check", "uncheck"])(
    "shows the focus the press of a %s moved with it",
    async (type) => {
      const [, , input] = await entriesWith({ type });

      expect(changesOf(input)).toEqual([
        focus('textbox "Search"', "lost"),
        focus('link "ayme"', "gained"),
        opening,
      ]);
    }
  );

  it("shows no focus moved by a click on the element that had the focus already", async () => {
    const onLink = searching
      .replace(`textbox "Search" [active]`, `textbox "Search"`)
      .replace(`link "ayme"`, `link "ayme" [active]`);
    const [, before, click] = await entriesWith({ first: onLink });

    expect(changesOf(before)).toEqual([
      expect.objectContaining({
        element: expect.stringContaining("paragraph"),
      }),
    ]);
    expect(changesOf(click)).toEqual([opening]);
  });

  it("leaves the focus a read shows moved before a click known from its report alone as a change of its own: the gate never held that click, so the read was not taken after its press", async () => {
    const [, before] = await entriesWith({ reported: true });

    expect(changesOf(before)).toEqual(
      expect.arrayContaining([
        focus('textbox "Search"', "lost"),
        focus('link "ayme"', "gained"),
      ])
    );
  });

  it("leaves the focus a read shows moved with the input that ended there when a click known from its report alone starts there", async () => {
    const [prior] = await entriesWith({ reported: true, priorEndsThere: true });

    expect(changesOf(prior)).toEqual(
      expect.arrayContaining([
        focus('textbox "Search"', "lost"),
        focus('link "ayme"', "gained"),
      ])
    );
  });

  it("leaves a focus moved at a read before the one a click starts at as a change of its own", async () => {
    // The click starts a read later: what moved the focus before that read
    // was no press of its.
    const later = opened.replace("Repository opened", "Banner gone");
    const prior = recorded(pressed)[2];
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, searching),
      prior!,
      snapshot(snapshotId("snapshot_2"), 20, pressed),
      snapshot(snapshotId("snapshot_3"), 30, later),
      snapshot(snapshotId("snapshot_4"), 40, opened),
      {
        kind: "interaction",
        interaction: {
          page: pageId("page_1"),
          report: {
            type: "click",
            selector: 'internal:role=link[name="ayme"s]',
            target: { ref: pictureRef("e3"), tree: later },
            values: { button: "left", clickCount: 1 },
          },
          before: snapshotId("snapshot_3"),
          after: snapshotId("snapshot_4"),
          at: 30,
        },
      },
    ]);
    const [, first] = timeline.visits().flatMap((one) => one.entries);

    expect(changesOf(first)).toEqual(
      expect.arrayContaining([
        focus('textbox "Search"', "lost"),
        focus('link "ayme"', "gained"),
      ])
    );
  });

  it.each([
    ["the entries reach that read by a step", false],
    ["the input before ends at that read", true],
  ])(
    "shows no focus move with a click at the read where recording resumed, when %s: the focus may have moved while paused",
    async (_, priorEndsThere) => {
      const entries = await entriesWith({ resumes: true, priorEndsThere });

      expect(changesOf(entries.at(-1))).toEqual([opening]);
    }
  );

  it("shows the clicked element gaining a focus no element had before, with the click", async () => {
    const [, before, click] = await entriesWith({
      first: searching.replace(" [active]", ""),
    });

    expect(changesOf(before)).toEqual([
      expect.objectContaining({
        element: expect.stringContaining("paragraph"),
      }),
    ]);
    expect(changesOf(click)).toEqual([focus('link "ayme"', "gained"), opening]);
  });

  it("leaves a focus moved before a key press as a change of its own: a key press moves no focus by its press", async () => {
    const [, before, press] = await entriesWith({ type: "press" });

    expect(changesOf(before)).toEqual(
      expect.arrayContaining([
        focus('textbox "Search"', "lost"),
        focus('link "ayme"', "gained"),
      ])
    );
    expect(changesOf(press)).toEqual([opening]);
  });

  it("leaves a focus moved to an element other than the one clicked, and not around it, as a change of its own", async () => {
    const [, before, click] = await entriesWith({ target: "e4" });

    expect(changesOf(before)).toEqual(
      expect.arrayContaining([focus('link "ayme"', "gained")])
    );
    expect(changesOf(click)).toEqual([opening]);
  });

  it("shows the focus with the click when the press focused an element around the one clicked", async () => {
    const card = (focused: "Search" | "Card", text: string) =>
      [
        `- generic [ref=e1]:`,
        `  - textbox "Search"${focused === "Search" ? " [active]" : ""} [ref=e2]`,
        `  - group "Card"${focused === "Card" ? " [active]" : ""} [ref=e3]:`,
        `    - link "ayme" [ref=e5]`,
        `  - paragraph [ref=e4]: ${text}`,
      ].join("\n");
    const [, , click] = await entriesWith({
      first: card("Search", "Nothing loaded"),
      second: card("Card", "Banner loaded"),
      third: card("Card", "Repository opened"),
      target: "e5",
    });

    expect(changesOf(click)).toEqual([
      focus('textbox "Search"', "lost"),
      focus('group "Card"', "gained"),
      opening,
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
      snapshot(snapshotId("snapshot_1"), 10, page),
      snapshot(snapshotId("snapshot_2"), 20, page),
      {
        kind: "interaction",
        interaction: {
          page: pageId("page_1"),
          report: {
            type: "click",
            selector: "#star",
            target: {
              ref: null,
              ancestors: [
                pictureRef("e99"),
                pictureRef("e6"),
                pictureRef("e5"),
              ],
              tree: listed,
            },
            values: { clickCount: 1 },
          },
          before: snapshotId("snapshot_1"),
          after: snapshotId("snapshot_2"),
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
      snapshot(snapshotId("snapshot_1"), 10, page),
      snapshot(snapshotId("snapshot_2"), 20, page),
      {
        kind: "interaction",
        interaction: {
          page: pageId("page_1"),
          report: {
            type: "press",
            selector: "body",
            target: { ref: null, ancestors: [], tree: listed },
            values: { key: "Escape", modifiers: 0 },
          },
          before: snapshotId("snapshot_1"),
          after: snapshotId("snapshot_2"),
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
      page: pageId("page_1"),
      report: {
        type,
        selector: `iframe >> internal:control=enter-frame >> ${type}`,
        target: { ref: pictureRef(ref), tree },
        values: {},
      },
      before: snapshotId("snapshot_1"),
      after: snapshotId("snapshot_2"),
      at: 10,
      ...(beforeFromReport ? { beforeFromReport } : {}),
    },
  });

  it("finds a click's target among the frame's elements", async () => {
    const text = await packageOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, withFrame("", "Empty")),
      snapshot(snapshotId("snapshot_2"), 20, withFrame("", "One item")),
      inFrame("click", "e9", frameAlone("")),
    ]);

    expect(text).toContain(`          targetRef: f1e3\n`);
  });

  it("takes typing's 'before' in the frame from the report's picture, and the rest of the page from the snapshot before it", async () => {
    const timeline = new Timeline();
    for (const addition of [
      visit,
      snapshot(snapshotId("snapshot_1"), 10, withFrame("", "Empty")),
      snapshot(
        snapshotId("snapshot_2"),
        20,
        withFrame(": milk", "Draft saved")
      ),
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
    snapshot(snapshotId("snapshot_1"), 10, idle),
    snapshot(snapshotId("snapshot_2"), 20, savedPage),
    click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
      ref: pictureRef("e2"),
      tree: idle,
    }),
    snapshot(snapshotId("snapshot_3"), 30, banner),
    snapshot(snapshotId("snapshot_4"), 40, banner),
    click(snapshotId("snapshot_3"), snapshotId("snapshot_4"), {
      ref: pictureRef("e2"),
      tree: banner,
    }),
  ];
  const timelineOf = async (additions: readonly TimelineAddition[]) => {
    const timeline = new Timeline();
    for (const addition of additions) await timeline.add(addition);
    return timeline;
  };
  const discard = (entry: EntryId): TimelineAddition => ({
    kind: "discard",
    entry,
  });
  const restore = (entry: EntryId): TimelineAddition => ({
    kind: "restore",
    entry,
  });

  it("gives every entry an identity that stays: an Interaction's, and a change's of its own", async () => {
    const timeline = await timelineOf(flow);

    expect(
      timeline.visits()[0]!.entries.map((entry) => [entry.kind, entry.id])
    ).toEqual([
      ["interaction", entryId("interaction_1")],
      ["change", entryId("change_1")],
      ["interaction", entryId("interaction_2")],
    ]);
  });

  it("marks a discarded entry where it is, keeps the rest as it was, and puts it back", async () => {
    const timeline = await timelineOf(flow);
    const before = timeline.visits();

    await timeline.add(discard(entryId("interaction_1")));
    const [first, change, second] = timeline.visits()[0]!.entries;
    expect(first).toMatchObject({
      id: entryId("interaction_1"),
      discarded: true,
    });
    // What it changed is still there: the window hides it, and a restore
    // brings it back as it was.
    expect(first).toHaveProperty("changes", [
      expect.objectContaining({ kind: "changed" }),
    ]);
    expect(change).not.toHaveProperty("discarded");
    expect(second).not.toHaveProperty("discarded");

    await timeline.add(restore(entryId("interaction_1")));
    expect(timeline.visits()).toEqual(before);
    expect(timeline.visits()[0]!.entries[0]).not.toHaveProperty("discarded");
  });

  it("discards a change of its own as well as an Interaction", async () => {
    const timeline = await timelineOf(flow);

    await timeline.add(discard(entryId("change_1")));

    expect(timeline.visits()[0]!.entries.map((entry) => entry.id)).toEqual([
      entryId("interaction_1"),
      entryId("change_1"),
      entryId("interaction_2"),
    ]);
    expect(timeline.visits()[0]!.entries[1]).toMatchObject({
      kind: "change",
      discarded: true,
    });
  });

  it("leaves what it does not have alone: the list is the same one", async () => {
    const timeline = await timelineOf(flow);
    const before = timeline.visits();

    await timeline.add(discard(entryId("interaction_9")));
    await timeline.add(restore(entryId("interaction_1")));

    expect(timeline.visits()).toBe(before);
  });

  it("writes a discarded entry as the released recorder does, a stub; the trace still has the Interaction's action", async () => {
    const timeline = await timelineOf(flow);
    await timeline.add(discard(entryId("interaction_1")));
    await timeline.add(discard(entryId("change_1")));

    expect(
      await timeline.package(
        header,
        tracePositions({ snapshot_1: "11", snapshot_3: "31" })
      )
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
    await timeline.add(discard(entryId("interaction_1")));
    await timeline.add(restore(entryId("interaction_1")));

    expect(await timeline.package(header)).toBe(kept);
  });

  it("still has a package when every entry was discarded, unlike a recording of nothing", async () => {
    const timeline = await timelineOf(flow);
    for (const entry of [
      entryId("interaction_1"),
      entryId("change_1"),
      entryId("interaction_2"),
    ])
      await timeline.add(discard(entry));

    const text = await timeline.package(header);

    expect(text).not.toBeNull();
    expect(text).not.toContain("changeTree:");
    expect(text!.match(/discarded: true/g)).toHaveLength(3);
    // Nothing was recorded here: that is empty, as before.
    expect(
      await (
        await timelineOf([visit, snapshot(snapshotId("snapshot_1"), 10, idle)])
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
      snapshot(snapshotId("snapshot_1"), 10, idle),
      {
        kind: "visit",
        page: pageId("page_1"),
        url: "http://shop.test/cart",
        cause: "navigate",
      },
      snapshot(snapshotId("snapshot_2"), 20, cart),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: idle,
      }),
      snapshot(snapshotId("snapshot_3"), 30, cart),
      snapshot(snapshotId("snapshot_4"), 40, paid),
      click(snapshotId("snapshot_3"), snapshotId("snapshot_4"), {
        ref: pictureRef("f1e3"),
        tree: cart,
      }),
    ]);
    const visitsBefore = timeline.visits().map((one) => one.visitId);

    await timeline.add(discard(entryId("interaction_1")));

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
  const assertion = (
    snapshot: SnapshotId,
    at: number,
    picked?: string,
    selector = 'internal:role=paragraph >> internal:has-text="Saved"i',
    locator = "getByRole('paragraph').filter({ hasText: 'Saved' })"
  ): TimelineAddition => ({
    kind: "interaction",
    interaction: {
      page: pageId("page_1"),
      report: {
        type: "assertVisible",
        selector,
        target: null,
        ...(picked ? { snapshotTarget: snapshotRefOf(picked) } : {}),
        locator,
        values: {},
      },
      before: snapshot,
      after: snapshot,
      at,
    },
  });

  it("writes an assertion with no Change Tree, and what changed since the last snapshot as a change before it (rule 7)", async () => {
    const text = await packageOf(
      [
        visit,
        snapshot(snapshotId("snapshot_1"), 10, idle),
        snapshot(snapshotId("snapshot_2"), 20, idle),
        click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
          ref: pictureRef("e2"),
          tree: idle,
        }),
        snapshot(snapshotId("snapshot_3"), 30, savedPage),
        assertion(snapshotId("snapshot_3"), 30),
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

  it("names the element picked for an assertion by the ref the recorder's snapshot gives it, as it names a click's target", async () => {
    const timeline = new Timeline();
    for (const addition of [
      visit,
      snapshot(snapshotId("snapshot_1"), 10, savedPage),
      assertion(snapshotId("snapshot_1"), 10, "e3"),
    ])
      await timeline.add(addition);

    expect(timeline.visits()[0]!.entries[0]).toMatchObject({
      interaction: { type: "assertVisible", targetRef: "e3" },
      targetElement: 'paragraph "Saved"',
    });
    expect(await timeline.package(header)).toContain(
      [
        `          type: assertVisible`,
        `          targetRef: e3`,
        `          targetSelector: internal:role=paragraph >> internal:has-text="Saved"i`,
      ].join("\n")
    );
  });

  it("names the element picked for an assertion from its own read when it is placed at an earlier one, as when typing followed it: the element appeared in between", async () => {
    const withNew = [savedPage, `  - button "New" [ref=e9]`].join("\n");
    const timeline = new Timeline();
    for (const addition of [
      visit,
      snapshot(snapshotId("snapshot_1"), 10, savedPage),
      snapshot(snapshotId("snapshot_2"), 20, withNew),
      {
        ...assertion(snapshotId("snapshot_1"), 10, "e9"),
        interaction: {
          ...(
            assertion(snapshotId("snapshot_1"), 10, "e9") as Extract<
              TimelineAddition,
              { kind: "interaction" }
            >
          ).interaction,
          targetRead: snapshotId("snapshot_2"),
        },
      } as TimelineAddition,
    ])
      await timeline.add(addition);

    expect(timeline.visits()[0]!.entries.at(-1)).toMatchObject({
      interaction: { type: "assertVisible", targetRef: "e9" },
      targetElement: 'button "New"',
    });
  });

  it("names an assertion whose picked element the snapshot does not list by its selector, in Playwright's own words, and the package keeps the selector only", async () => {
    const timeline = new Timeline();
    for (const addition of [
      visit,
      snapshot(snapshotId("snapshot_1"), 10, savedPage),
      assertion(snapshotId("snapshot_1"), 10, "e9"),
    ])
      await timeline.add(addition);

    const [entry] = timeline.visits()[0]!.entries;
    expect(entry).toMatchObject({
      interaction: { targetRef: null },
      targetElement: "getByRole('paragraph').filter({ hasText: 'Saved' })",
    });
    expect(await timeline.package(header)).not.toContain("getByRole");
  });

  it("gives every entry Playwright's own words for its selector, for whoever shows it, and the package does not have them", async () => {
    const timeline = new Timeline();
    for (const addition of [
      visit,
      snapshot(snapshotId("snapshot_1"), 10, savedPage),
      assertion(snapshotId("snapshot_1"), 10, "e3"),
    ])
      await timeline.add(addition);

    expect(timeline.visits()[0]!.entries[0]).toMatchObject({
      targetElement: 'paragraph "Saved"',
      targetLocator: "getByRole('paragraph').filter({ hasText: 'Saved' })",
    });
    expect(await timeline.package(header)).not.toContain("getByRole");
  });

  it("names an assertion with no ref whose selector is a role and a name as a label reads", async () => {
    const timeline = new Timeline();
    for (const addition of [
      visit,
      snapshot(snapshotId("snapshot_1"), 10, savedPage),
      assertion(
        snapshotId("snapshot_1"),
        10,
        undefined,
        'internal:role=link[name="chore: release main"i]',
        "getByRole('link', { name: 'chore: release main' })"
      ),
    ])
      await timeline.add(addition);

    expect(timeline.visits()[0]!.entries[0]).toMatchObject({
      interaction: {
        targetRef: null,
        targetSelector: 'internal:role=link[name="chore: release main"i]',
      },
      targetElement: 'link "chore: release main"',
    });
  });

  it("starts a Visit whose first entry is an assertion with the page as it stood at the assertion", async () => {
    const text = await packageOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, savedPage),
      assertion(snapshotId("snapshot_2"), 20),
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

// Where an entry's element is now, for the hover highlight: its target by
// its recorded selector, the element of a row of its changes by its ref while
// the page's latest snapshot lists it, and by the selector of its label
// after.
describe("the timeline, for the highlight", () => {
  const recreated = [
    `- generic [ref=e1]:`,
    `  - button "Save" [ref=e8]`,
    `  - paragraph [ref=e9]: Saved`,
  ].join("\n");
  const without = [`- generic [ref=e1]:`, `  - button "Save" [ref=e2]`].join(
    "\n"
  );
  async function timelineOf(additions: readonly TimelineAddition[]) {
    const timeline = new Timeline();
    for (const addition of additions) await timeline.add(addition);
    return timeline;
  }
  const clicked = [
    visit,
    snapshot(snapshotId("snapshot_1"), 10, idle),
    snapshot(snapshotId("snapshot_2"), 20, savedPage),
    click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
      ref: pictureRef("e2"),
      tree: idle,
    }),
  ];
  const page1 = pageId("page_1");
  const interaction1 = entryId("interaction_1");

  it("finds an Interaction's target on the page it is still on by the ref the page's latest snapshot gives it, as a row's element, the page having re-created it", async () => {
    const timeline = await timelineOf([
      ...clicked,
      snapshot(snapshotId("snapshot_3"), 30, recreated),
    ]);

    expect(timeline.liveTarget(interaction1)).toEqual({
      page: page1,
      find: { by: "ref", ref: "e8" },
    });
  });

  it("finds an Interaction's target the latest snapshot no longer lists by its recorded selector", async () => {
    const timeline = await timelineOf([
      ...clicked,
      snapshot(
        snapshotId("snapshot_3"),
        30,
        [`- generic [ref=e1]:`, `  - paragraph [ref=e3]: Saved`].join("\n")
      ),
    ]);

    expect(timeline.liveTarget(interaction1)).toEqual({
      page: page1,
      find: { by: "selector", selector: 'internal:role=button[name="Save"i]' },
    });
  });

  it("finds the element of a row of an entry's changes by the ref the page's latest snapshot gives it", async () => {
    const timeline = await timelineOf(clicked);

    expect(timeline.liveTarget(interaction1, 0)).toEqual({
      page: page1,
      find: { by: "ref", ref: "e3" },
    });
  });

  it("finds an element the page re-created by its ref now, not the first one the package keeps", async () => {
    const timeline = await timelineOf([
      ...clicked,
      snapshot(snapshotId("snapshot_3"), 30, recreated),
    ]);

    expect(timeline.liveTarget(interaction1, 0)).toMatchObject({
      find: { by: "ref", ref: "e9" },
    });
  });

  it("finds an element the latest snapshot no longer lists by the selector of its label", async () => {
    const offer = [
      savedPage,
      `  - button "Remove" [ref=e4]`,
      `  - list [ref=e5]:`,
      `    - listitem [ref=e6]: Milk`,
    ].join("\n");
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, offer),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: idle,
      }),
      snapshot(snapshotId("snapshot_3"), 30, without),
    ]);
    expect(timeline.visits()[0]!.entries[0]!.changes).toEqual([
      expect.objectContaining({ element: 'paragraph "Saved"' }),
      expect.objectContaining({ element: 'button "Remove"' }),
      expect.objectContaining({ element: "list" }),
    ]);

    expect(timeline.liveTarget(interaction1, 0)).toEqual({
      page: page1,
      find: {
        by: "selector",
        selector: 'internal:role=paragraph >> internal:has-text="Saved"s',
      },
    });
    expect(timeline.liveTarget(interaction1, 1)).toEqual({
      page: page1,
      find: {
        by: "selector",
        selector: 'internal:role=button[name="Remove"s]',
      },
    });
    expect(timeline.liveTarget(interaction1, 2)).toEqual({
      page: page1,
      find: { by: "selector", selector: "internal:role=list" },
    });
  });

  it("finds the element of a row of a change of its own", async () => {
    const timeline = await timelineOf([
      ...clicked,
      snapshot(snapshotId("snapshot_3"), 30, idle),
    ]);
    await timeline.package(header);

    expect(timeline.liveTarget(entryId("change_1"), 0)).toEqual({
      page: page1,
      find: { by: "ref", ref: "e3" },
    });
  });

  it("finds nothing for a row an entry does not have, nor for an element named by nothing", async () => {
    const timeline = await timelineOf([
      ...clicked,
      snapshot(
        snapshotId("snapshot_3"),
        30,
        `${savedPage}\n  - generic [ref=e5]`
      ),
    ]);
    await timeline.package(header);
    expect(timeline.visits()[0]!.entries[1]!.changes).toEqual([
      { kind: "added", element: "element" },
    ]);

    expect(timeline.liveTarget(interaction1, 1)).toBeNull();
    expect(timeline.liveTarget(entryId("change_1"), 0)).toBeNull();
  });

  it("finds an entry of a Visit its page has left on the page as it is now: its target by its selector, a row's element by the selector of its label, never by a ref of the Visit left", async () => {
    const offer = [savedPage, `  - button "Remove" [ref=e4]`].join("\n");
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, offer),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: idle,
      }),
      {
        kind: "visit",
        page: page1,
        url: "http://shop.test/cart",
        cause: "navigate",
      },
      // The page's new document gives the same refs to other elements.
      snapshot(snapshotId("snapshot_3"), 30, offer),
    ]);
    expect(timeline.visits()[0]!.entries[0]!.changes).toEqual([
      expect.objectContaining({ element: 'paragraph "Saved"' }),
      expect.objectContaining({ element: 'button "Remove"' }),
    ]);

    expect(timeline.liveTarget(interaction1)).toEqual({
      page: page1,
      find: { by: "selector", selector: 'internal:role=button[name="Save"i]' },
    });
    expect(timeline.liveTarget(interaction1, 0)).toEqual({
      page: page1,
      find: {
        by: "selector",
        selector: 'internal:role=paragraph >> internal:has-text="Saved"s',
      },
    });
    expect(timeline.liveTarget(interaction1, 1)).toEqual({
      page: page1,
      find: {
        by: "selector",
        selector: 'internal:role=button[name="Remove"s]',
      },
    });
    expect(timeline.liveTarget(interaction1, 2)).toBeNull();
  });

  it("finds a row's element by the selector of its label, never by a ref, once its page went elsewhere while the recorder was paused, and by its ref after a change of only the query or the hash", async () => {
    const offer = [savedPage, `  - button "Remove" [ref=e4]`].join("\n");
    const recorded = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, offer),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: idle,
      }),
    ]);
    const hashOnly = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, offer),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: idle,
      }),
    ]);

    await recorded.add({
      kind: "elsewhere",
      page: page1,
      url: "http://shop.test/cart",
    });
    await hashOnly.add({ kind: "elsewhere", page: page1, url: `${url}#top` });

    expect(recorded.liveTarget(interaction1, 1)).toEqual({
      page: page1,
      find: {
        by: "selector",
        selector: 'internal:role=button[name="Remove"s]',
      },
    });
    expect(hashOnly.liveTarget(interaction1, 1)).toEqual({
      page: page1,
      find: { by: "ref", ref: snapshotRefOf("e4") },
    });
  });

  it("finds nothing for the target of a change of its own, of an entry it does not have, or of one with no selector", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, idle),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), null, null),
      snapshot(snapshotId("snapshot_3"), 30, savedPage),
    ]);
    await timeline.package(header);

    expect(timeline.liveTarget(interaction1)).toBeNull();
    // It changed nothing: it has no row.
    expect(timeline.liveTarget(interaction1, 0)).toBeNull();
    expect(timeline.liveTarget(entryId("change_1"))).toBeNull();
    expect(timeline.liveTarget(entryId("interaction_9"))).toBeNull();
  });
});

// The review of the whole recorder against the spec.
describe("the timeline, for what the review against the spec found", () => {
  it("leaves out what the page changed while paused: the snapshot where recording resumes is the new point to compare from (rule 13)", async () => {
    const withStatus = (text: string, status: string) =>
      [
        `- generic [ref=e1]:`,
        `  - button "Save" [ref=e2]`,
        `  - paragraph [ref=e3]: ${text}`,
        `  - status [ref=e4]: ${status}`,
      ].join("\n");
    const timeline = new Timeline();
    for (const addition of [
      visit,
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, savedPage),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), null),
      // The last snapshot before the pause, and the first after it: the
      // page got a status while paused.
      snapshot(snapshotId("snapshot_3"), 30, savedPage),
      {
        ...snapshot(
          snapshotId("snapshot_4"),
          40,
          withStatus("Saved", "Paused work")
        ),
        resumes: true,
      },
      // What it changed by itself after Continue is the recording's.
      snapshot(
        snapshotId("snapshot_5"),
        50,
        withStatus("Saved again", "Paused work")
      ),
      snapshot(
        snapshotId("snapshot_6"),
        60,
        withStatus("Not saved", "Paused work")
      ),
      click(snapshotId("snapshot_5"), snapshotId("snapshot_6"), null),
    ] satisfies TimelineAddition[])
      await timeline.add(addition);

    expect(
      timeline
        .visits()[0]!
        .entries.map((entry) => [
          entry.kind,
          entry.changes?.map((row) => `${row.kind} ${row.element}`),
        ])
    ).toEqual([
      ["interaction", ['changed paragraph "Saved"']],
      ["change", ['changed paragraph "Saved again"']],
      ["interaction", ['changed paragraph "Not saved"']],
    ]);
    expect(await timeline.package(header)).not.toContain("Paused work");
  });

  it("still writes an Interaction that starts at a snapshot the entries have passed: nothing done while recording is left out", async () => {
    const done = [
      `- generic [ref=e1]:`,
      `  - button "Save" [ref=e2]`,
      `  - paragraph [ref=e3]: Saved`,
      `  - status [ref=e4]: Done`,
    ].join("\n");

    const text = await packageOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, savedPage),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), null),
      snapshot(snapshotId("snapshot_3"), 30, done),
      // It shares its "before" with the Interaction ahead of it.
      click(snapshotId("snapshot_1"), snapshotId("snapshot_3"), null),
    ]);

    expect(text!.match(/kind: interaction/g)).toHaveLength(2);
    expect(text).toContain(
      [
        `          id: interaction_2`,
        `          type: click`,
        `          targetRef: null`,
        `          targetSelector: internal:role=button[name="Save"i]`,
        `          button: left`,
        `          modifiers: 0`,
        `          clickCount: 1`,
        `        changeTree:`,
        `          - [ref=e1]:`,
        `            - <changed> [ref=e3] paragraph: Saved`,
        `            - <added> [ref=e4] status: Done`,
        `traceActionPoints: []`,
        ``,
      ].join("\n")
    );
  });
});
