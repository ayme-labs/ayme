import { describe, expect, it } from "vitest";

import type { TimelineAddition } from "./recorded";
import {
  header,
  page,
  snapshot,
  timelineOf,
  visit,
} from "./test-utils/timelineBuilders";
import type { Timeline } from "./timeline";
import type { SnapshotId } from "./recorded";
import { pictureRef, type PictureRef } from "./refs";
import {
  entryId,
  pageId,
  snapshotId,
  tracePositions,
} from "../../test-utils/ids";

// Rules of the timeline that the change analysis found unpinned: what it
// leaves out, when it tells an entry, and what it knows of a target.

const click = (
  before: SnapshotId,
  after: SnapshotId | null,
  target: { ref: PictureRef; tree: string } | null,
  selector: string | null = 'internal:role=button[name="Save"i]'
): TimelineAddition => ({
  kind: "interaction",
  interaction: {
    page: pageId("page_1"),
    report: { type: "click", selector, target, values: {} },
    before,
    after,
    at: 15,
  },
});
const kinds = (timeline: Timeline) =>
  timeline.visits().map((one) => one.entries.map((entry) => entry.id));

const idle = page(
  `- button "Save" [ref=e2]`,
  `- paragraph [ref=e3]: Not saved`
);
const saved = page(`- button "Save" [ref=e2]`, `- paragraph [ref=e3]: Saved`);
const offer = page(
  `- button "Save" [ref=e2]`,
  `- paragraph [ref=e3]: Saved`,
  `- alert [ref=e4]: Offer ends soon`
);
const savedTwice = page(
  `- button "Save" [ref=e2]`,
  `- paragraph [ref=e3]: Saved twice`,
  `- alert [ref=e4]: Offer ends soon`
);

describe("what the timeline leaves out", () => {
  it("leaves out an Interaction of a page that has no Visit, as it leaves out the page's snapshots", async () => {
    const timeline = await timelineOf([
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, saved),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: idle,
      }),
    ]);

    expect(timeline.visits()).toEqual([]);
    // No Interaction was recorded: the recording is empty.
    expect(await timeline.package(header)).toBeNull();
  });

  it("leaves a Visit no page was read in out of the package: it has no picture to start from", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, saved),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: idle,
      }),
      // A page that opened and was never read.
      {
        kind: "visit",
        page: pageId("page_2"),
        url: "http://shop.test/help",
        cause: "openPage",
      },
    ]);

    expect(timeline.visits().map((one) => one.visitId)).toEqual([
      "visit_1",
      "visit_2",
    ]);
    const text = await timeline.package(header);
    expect(text).toContain("  - visitId: visit_1\n");
    expect(text).not.toContain("visit_2");
  });
});

describe("when the timeline tells an entry", () => {
  it("keeps a step between two snapshots to itself until an Interaction claims it or the next one comes, also when every snapshot is in before the first Interaction", async () => {
    // Playwright's reports come late: all four snapshots are in by then.
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, saved),
      snapshot(snapshotId("snapshot_3"), 30, offer),
      snapshot(snapshotId("snapshot_4"), 40, savedTwice),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: idle,
      }),
    ]);
    expect(kinds(timeline)).toEqual([[entryId("interaction_1")]]);

    await timeline.add(
      click(snapshotId("snapshot_3"), snapshotId("snapshot_4"), {
        ref: pictureRef("e2"),
        tree: offer,
      })
    );

    expect(timeline.visits()[0]!.entries.slice(1)).toMatchObject([
      {
        id: entryId("change_1"),
        kind: "change",
        timestamp: 30,
        changes: [{ kind: "added", element: 'alert "Offer ends soon"' }],
      },
      {
        id: entryId("interaction_2"),
        changes: [{ kind: "changed", element: 'paragraph "Saved twice"' }],
      },
    ]);
  });

  it("writes an Interaction that comes late, after one that started later, without telling any step twice", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, saved),
      snapshot(snapshotId("snapshot_3"), 30, offer),
      click(snapshotId("snapshot_2"), snapshotId("snapshot_3"), {
        ref: pictureRef("e2"),
        tree: saved,
      }),
      // The earlier one's report came after the later one's.
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: idle,
      }),
    ]);

    await timeline.package(header);

    expect(kinds(timeline)).toEqual([
      [entryId("interaction_1"), entryId("interaction_2")],
    ]);
  });

  it("tells the same list of Visits when making the package adds no entry", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, saved),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: idle,
      }),
    ]);
    const told = timeline.visits();

    await timeline.package(header);

    expect(timeline.visits()).toBe(told);
  });

  it("tells a change on a page with more than one top-level element when only one of them changed", async () => {
    const before = [`- button "Save" [ref=e2]`, `- status [ref=e3]: Idle`];
    const after = [`- button "Save" [ref=e2]`, `- status [ref=e3]: Busy`];
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, before.join("\n")),
      snapshot(snapshotId("snapshot_2"), 20, after.join("\n")),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: before.join("\n"),
      }),
    ]);

    expect(timeline.visits()[0]!.entries).toMatchObject([
      { changes: [{ kind: "changed", element: 'status "Busy"' }] },
    ]);
  });
});

describe("what changed before an input known from its report", () => {
  const typing = (
    before: SnapshotId,
    after: SnapshotId,
    picture: string | null
  ): TimelineAddition => ({
    kind: "interaction",
    interaction: {
      page: pageId("page_1"),
      report: {
        type: "fill",
        selector: 'internal:role=textbox[name="Item"i]',
        target:
          picture === null ? null : { ref: pictureRef("e21"), tree: picture },
        values: {},
      },
      before,
      after,
      at: 15,
      beforeFromReport: true,
    },
  });
  const empty = page(`- textbox "Item" [ref=e2]`);
  const milk = page(
    `- textbox "Item" [ref=e2]: milk`,
    `- alert [ref=e3]: Welcome back`
  );
  const milkAndEggs = page(
    `- textbox "Item" [ref=e2]: milk, eggs`,
    `- alert [ref=e3]: Welcome back`,
    `- status [ref=e4]: Online`
  );

  it("is an entry of its own, counted with the other changes of the recording", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, empty),
      snapshot(snapshotId("snapshot_2"), 20, milk),
      // The alert was there when the person typed.
      typing(
        snapshotId("snapshot_1"),
        snapshotId("snapshot_2"),
        [
          `- generic [ref=e20]:`,
          `  - textbox "Item" [ref=e21]: m`,
          `  - alert [ref=e22]: Welcome back`,
        ].join("\n")
      ),
      snapshot(snapshotId("snapshot_3"), 30, milkAndEggs),
      // So was the status, the second time.
      typing(
        snapshotId("snapshot_2"),
        snapshotId("snapshot_3"),
        [
          `- generic [ref=e20]:`,
          `  - textbox "Item" [ref=e21]: milk,`,
          `  - alert [ref=e22]: Welcome back`,
          `  - status [ref=e23]: Online`,
        ].join("\n")
      ),
    ]);

    expect(kinds(timeline)).toEqual([
      [
        entryId("change_1"),
        entryId("interaction_1"),
        entryId("change_2"),
        entryId("interaction_2"),
      ],
    ]);
  });

  it("is not known for a report that has no picture: the input is written with its 'after' only, and warned of", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, empty),
      snapshot(snapshotId("snapshot_2"), 20, milk),
      typing(snapshotId("snapshot_1"), snapshotId("snapshot_2"), null),
    ]);

    expect(timeline.visits()[0]!.entries).toMatchObject([
      {
        id: entryId("interaction_1"),
        interaction: { targetRef: null },
        changes: [
          { kind: "changed", element: 'textbox "Item"' },
          { kind: "added", element: 'alert "Welcome back"' },
        ],
      },
    ]);
    expect(timeline.warnings().map((warning) => warning.kind)).toEqual([
      "reportShape",
    ]);
  });
});

describe("where the trace holds an Interaction", () => {
  it("tells of as many snapshots as the trace has: one it does not hold has no position", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, saved),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: idle,
      }),
    ]);

    expect(
      await timeline.package(header, tracePositions({ snapshot_2: "17" }))
    ).toContain(
      [
        `traceActionPoints:`,
        `  - interactionId: interaction_1`,
        `    pageId: page_1`,
        `    afterSnapshotId: "17"`,
        `    startedAt: 15`,
        `    endedAt: 20`,
        ``,
      ].join("\n")
    );
  });
});

describe("where an entry's target is now, for the highlight", () => {
  it("finds nothing for a change of its own: it has no target", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, saved),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: idle,
      }),
      snapshot(snapshotId("snapshot_3"), 30, offer),
      snapshot(snapshotId("snapshot_4"), 40, savedTwice),
      click(snapshotId("snapshot_3"), snapshotId("snapshot_4"), {
        ref: pictureRef("e2"),
        tree: offer,
      }),
    ]);
    expect(kinds(timeline)).toEqual([
      [entryId("interaction_1"), entryId("change_1"), entryId("interaction_2")],
    ]);

    expect(timeline.liveTarget(entryId("change_1"))).toBeNull();
  });

  it("finds nothing for an Interaction with neither a target ref nor a selector", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, saved),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), null, null),
    ]);

    expect(timeline.liveTarget(entryId("interaction_1"))).toBeNull();
  });

  it("finds the element of a row by the selector of its label when the page gave it no ref: only the browser's refs name an element of the page", async () => {
    // The snapshots list the option without a ref.
    const choice = page(`- combobox "Size" [ref=e2]:`, `  - option "Large"`);
    const chosen = page(
      `- combobox "Size" [ref=e2]:`,
      `  - option "Large" [selected]`
    );
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, choice),
      snapshot(snapshotId("snapshot_2"), 20, chosen),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: choice,
      }),
    ]);
    expect(timeline.visits()[0]!.entries[0]!.changes).toEqual([
      expect.objectContaining({ element: 'option "Large"' }),
    ]);

    expect(timeline.liveTarget(entryId("interaction_1"), 0)).toMatchObject({
      find: {
        by: "selector",
        selector: 'internal:role=option[name="Large"s]',
      },
    });
  });
});

describe("a change row's element in words, for whoever shows the entry", () => {
  it("names a removed element by its place on the page before the change, not where the change tree puts it", async () => {
    // The second of two look-alikes goes; the other moves after a third.
    const timeline = await timelineOf([
      visit,
      snapshot(
        snapshotId("snapshot_1"),
        10,
        page(
          `- button "Save" [ref=e2]`,
          `- listitem [ref=e4]: Twin`,
          `- listitem [ref=e5]: Twin`,
          `- listitem [ref=e6]: Other`
        )
      ),
      snapshot(
        snapshotId("snapshot_2"),
        20,
        page(
          `- button "Save" [ref=e2]`,
          `- listitem [ref=e6]: Other`,
          `- listitem [ref=e4]: Twin`
        )
      ),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: idle,
      }),
    ]);

    expect(timeline.visits()[0]!.entries[0]!).toMatchObject({
      changes: expect.arrayContaining([
        { kind: "removed", element: 'listitem "Twin" (2nd of 2)' },
      ]),
    });
  });
});

describe("an entry's target in words, for whoever shows the entry", () => {
  it("is the role and name of the element its target ref names, and the package does not have it", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, saved),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), {
        ref: pictureRef("e2"),
        tree: idle,
      }),
    ]);

    expect(timeline.visits()[0]!.entries[0]).toMatchObject({
      interaction: { targetRef: "e2" },
      targetElement: 'button "Save"',
    });
    expect(await timeline.package(header)).not.toContain("targetElement");
  });

  it("is the element Playwright's picture of the page shows, for an input known from its report", async () => {
    const field = page(`- textbox "Item" [ref=e2]`);
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, field),
      snapshot(
        snapshotId("snapshot_2"),
        20,
        page(`- textbox "Item" [ref=e2]: m`)
      ),
      {
        kind: "interaction",
        interaction: {
          page: pageId("page_1"),
          report: {
            type: "fill",
            selector: "#item",
            target: {
              ref: pictureRef("e21"),
              tree: [
                `- generic [ref=e20]:`,
                `  - textbox "Item" [ref=e21]: m`,
              ].join("\n"),
            },
            values: { text: "m" },
          },
          before: snapshotId("snapshot_1"),
          after: snapshotId("snapshot_2"),
          at: 15,
          beforeFromReport: true,
        },
      },
    ]);

    expect(timeline.visits()[0]!.entries[0]).toMatchObject({
      interaction: { targetRef: "e2" },
      targetElement: 'textbox "Item"',
    });
  });

  it("is its selector's words for a target the page's structure does not know, and not there without a selector", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot(snapshotId("snapshot_1"), 10, idle),
      snapshot(snapshotId("snapshot_2"), 20, saved),
      click(snapshotId("snapshot_1"), snapshotId("snapshot_2"), null),
      snapshot(snapshotId("snapshot_3"), 30, saved),
      click(snapshotId("snapshot_2"), snapshotId("snapshot_3"), null, null),
    ]);

    const [first, second] = timeline.visits()[0]!.entries;
    expect(first).toMatchObject({
      interaction: { targetRef: null },
      targetElement: 'button "Save"',
    });
    expect(second).toMatchObject({ interaction: { targetRef: null } });
    expect(second).not.toHaveProperty("targetElement");
  });
});
