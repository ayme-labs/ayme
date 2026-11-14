import { describe, expect, it } from "vitest";

import type { PageSnapshot, TimelineAddition } from "./recorded";
import { Timeline, type PackageHeader } from "./timeline";

// Rules of the timeline that the change analysis found unpinned: what it
// leaves out, when it tells an entry, and what it knows of a target.

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
  target: { ref: string; tree: string } | null,
  selector: string | null = 'internal:role=button[name="Save"i]'
): TimelineAddition => ({
  kind: "interaction",
  interaction: {
    page: "page_1",
    report: { type: "click", selector, target, values: {} },
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
const kinds = (timeline: Timeline) =>
  timeline.visits().map((one) => one.entries.map((entry) => entry.id));

const page = (...elements: string[]) =>
  [`- generic [ref=e1]:`, ...elements.map((line) => `  ${line}`)].join("\n");
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
      snapshot("snapshot_1", 10, idle),
      snapshot("snapshot_2", 20, saved),
      click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
    ]);

    expect(timeline.visits()).toEqual([]);
    // No Interaction was recorded: the recording is empty.
    expect(await timeline.package(header)).toBeNull();
  });

  it("leaves a Visit no page was read in out of the package: it has no picture to start from", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot("snapshot_1", 10, idle),
      snapshot("snapshot_2", 20, saved),
      click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
      // A page that opened and was never read.
      {
        kind: "visit",
        page: "page_2",
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
      snapshot("snapshot_1", 10, idle),
      snapshot("snapshot_2", 20, saved),
      snapshot("snapshot_3", 30, offer),
      snapshot("snapshot_4", 40, savedTwice),
      click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
    ]);
    expect(kinds(timeline)).toEqual([["interaction_1"]]);

    await timeline.add(
      click("snapshot_3", "snapshot_4", { ref: "e2", tree: offer })
    );

    expect(timeline.visits()[0]!.entries.slice(1)).toMatchObject([
      {
        id: "change_1",
        kind: "change",
        timestamp: 30,
        changeTree: [
          `- [ref=e1]:`,
          `  - <added> [ref=e4] alert: Offer ends soon`,
        ].join("\n"),
      },
      {
        id: "interaction_2",
        changeTree: [
          `- [ref=e1]:`,
          `  - <changed> [ref=e3] paragraph: Saved twice`,
        ].join("\n"),
      },
    ]);
  });

  it("writes an Interaction that comes late, after one that started later, without telling any step twice", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot("snapshot_1", 10, idle),
      snapshot("snapshot_2", 20, saved),
      snapshot("snapshot_3", 30, offer),
      click("snapshot_2", "snapshot_3", { ref: "e2", tree: saved }),
      // The earlier one's report came after the later one's.
      click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
    ]);

    await timeline.package(header);

    expect(kinds(timeline)).toEqual([["interaction_1", "interaction_2"]]);
  });

  it("tells the same list of Visits when making the package adds no entry", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot("snapshot_1", 10, idle),
      snapshot("snapshot_2", 20, saved),
      click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
    ]);
    const told = timeline.visits();

    await timeline.package(header);

    expect(timeline.visits()).toBe(told);
  });
});

describe("what changed before an input known from its report", () => {
  const typing = (
    before: string,
    after: string,
    picture: string | null
  ): TimelineAddition => ({
    kind: "interaction",
    interaction: {
      page: "page_1",
      report: {
        type: "fill",
        selector: 'internal:role=textbox[name="Item"i]',
        target: picture === null ? null : { ref: "e21", tree: picture },
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
      snapshot("snapshot_1", 10, empty),
      snapshot("snapshot_2", 20, milk),
      // The alert was there when the person typed.
      typing(
        "snapshot_1",
        "snapshot_2",
        [
          `- generic [ref=e20]:`,
          `  - textbox "Item" [ref=e21]: m`,
          `  - alert [ref=e22]: Welcome back`,
        ].join("\n")
      ),
      snapshot("snapshot_3", 30, milkAndEggs),
      // So was the status, the second time.
      typing(
        "snapshot_2",
        "snapshot_3",
        [
          `- generic [ref=e20]:`,
          `  - textbox "Item" [ref=e21]: milk,`,
          `  - alert [ref=e22]: Welcome back`,
          `  - status [ref=e23]: Online`,
        ].join("\n")
      ),
    ]);

    expect(kinds(timeline)).toEqual([
      ["change_1", "interaction_1", "change_2", "interaction_2"],
    ]);
  });

  it("is not known for a report that has no picture: the input is written with its 'after' only, and warned of", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot("snapshot_1", 10, empty),
      snapshot("snapshot_2", 20, milk),
      typing("snapshot_1", "snapshot_2", null),
    ]);

    expect(timeline.visits()[0]!.entries).toMatchObject([
      {
        id: "interaction_1",
        interaction: { targetRef: null },
        changeTree: [
          `- [ref=e1]:`,
          `  - <changed> [ref=e2] textbox "Item": milk`,
          `  - <added> [ref=e3] alert: Welcome back`,
        ].join("\n"),
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
      snapshot("snapshot_1", 10, idle),
      snapshot("snapshot_2", 20, saved),
      click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
    ]);

    expect(await timeline.package(header, { snapshot_2: "17" })).toContain(
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
      snapshot("snapshot_1", 10, idle),
      snapshot("snapshot_2", 20, saved),
      click("snapshot_1", "snapshot_2", { ref: "e2", tree: idle }),
      snapshot("snapshot_3", 30, offer),
      snapshot("snapshot_4", 40, savedTwice),
      click("snapshot_3", "snapshot_4", { ref: "e2", tree: offer }),
    ]);
    expect(kinds(timeline)).toEqual([
      ["interaction_1", "change_1", "interaction_2"],
    ]);

    expect(timeline.liveTarget("change_1")).toBeNull();
  });

  it("finds nothing for an Interaction with neither a target ref nor a selector", async () => {
    const timeline = await timelineOf([
      visit,
      snapshot("snapshot_1", 10, idle),
      snapshot("snapshot_2", 20, saved),
      click("snapshot_1", "snapshot_2", null, null),
    ]);

    expect(timeline.liveTarget("interaction_1")).toBeNull();
  });

  it("finds nothing by a ref the browser did not give: only the browser's refs name an element of the page", async () => {
    // The snapshot lists the option without a ref; Playwright's own picture
    // of the page gives it one.
    const choice = page(`- combobox "Size" [ref=e2]:`, `  - option "Large"`);
    const timeline = await timelineOf([
      visit,
      snapshot("snapshot_1", 10, choice),
      snapshot("snapshot_2", 20, choice),
      click("snapshot_1", "snapshot_2", {
        ref: "e22",
        tree: [
          `- generic [ref=e20]:`,
          `  - combobox "Size" [ref=e21]:`,
          `    - option "Large" [ref=e22]`,
        ].join("\n"),
      }),
    ]);
    const [entry] = timeline.visits()[0]!.entries;
    expect(entry).toMatchObject({
      interaction: { targetRef: expect.stringMatching(/^s_\d+$/) },
    });

    expect(timeline.liveTarget("interaction_1")).toBeNull();
  });
});
