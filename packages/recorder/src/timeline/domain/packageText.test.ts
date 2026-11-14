import { describe, expect, it } from "vitest";

import type { TimelineAddition } from "./recorded";
import { Timeline, type PackageHeader } from "./timeline";

// How a recording is written: the released layout of the Recording Package,
// where the fixture of three clicks does not reach.

const header: PackageHeader = {
  recordingId: "rec_20261112T145047604Z",
  createdAt: "2026-11-12T14:50:47.604Z",
  tracePath: null,
};
const url = "http://shop.test/";
const lines = (...all: string[]) => all.join("\n");

/** A timeline of one click, held by the gate, between two snapshots. */
async function clicked(input: {
  before: string;
  after: string;
  selector?: string | null;
  values?: Record<string, unknown>;
}) {
  const timeline = new Timeline();
  const additions: TimelineAddition[] = [
    { kind: "visit", page: "page_1", url, cause: "initial" },
    ...[input.before, input.after].map((tree, index): TimelineAddition => ({
      kind: "snapshot",
      snapshot: {
        id: `snapshot_${index + 1}`,
        page: "page_1",
        url,
        at: 10 * (index + 1),
        tree,
      },
    })),
    {
      kind: "interaction",
      interaction: {
        page: "page_1",
        report: {
          type: "click",
          selector: input.selector ?? null,
          target: null,
          values: input.values ?? {},
        },
        before: "snapshot_1",
        after: "snapshot_2",
        at: 15,
      },
    },
  ];
  for (const addition of additions) await timeline.add(addition);
  return timeline;
}
const page = (...elements: string[]) =>
  lines(`- generic [ref=e1]:`, ...elements.map((line) => `  ${line}`));
const idle = page(`- button "Save" [ref=e2]`);

describe("the Recording Package's text", () => {
  it("lists of an Interaction what Playwright said of it and no more, in the released order of fields", async () => {
    const timeline = await clicked({
      before: idle,
      after: idle,
      selector: "internal:role=button",
      // As Playwright gives them, in another order, with one the package
      // does not know.
      values: { clickCount: 2, startTime: 99, modifiers: 0, button: "left" },
    });

    const [entry] = timeline.visits()[0]!.entries;
    if (entry?.kind !== "interaction") throw new Error("No Interaction.");
    expect(Object.entries(entry.interaction)).toEqual([
      ["id", "interaction_1"],
      ["type", "click"],
      ["targetRef", null],
      ["targetSelector", "internal:role=button"],
      ["button", "left"],
      ["modifiers", 0],
      ["clickCount", 2],
    ]);
  });

  it("lists everything Playwright can say of an Interaction in the released order", async () => {
    const timeline = await clicked({
      before: idle,
      after: idle,
      // In no order of the package's.
      values: {
        options: ["Large"],
        files: ["report.pdf"],
        key: "Enter",
        position: { x: 3, y: 4 },
        clickCount: 1,
        modifiers: 0,
        button: "left",
        text: "milk",
        value: "Large",
        url: "http://shop.test/cart",
      },
    });

    const [entry] = timeline.visits()[0]!.entries;
    if (entry?.kind !== "interaction") throw new Error("No Interaction.");
    expect(Object.keys(entry.interaction)).toEqual([
      "id",
      "type",
      "targetRef",
      "url",
      "value",
      "text",
      "button",
      "modifiers",
      "clickCount",
      "position",
      "key",
      "files",
      "options",
    ]);
    expect(entry.interaction).toMatchObject({
      url: "http://shop.test/cart",
      value: "Large",
      position: { x: 3, y: 4 },
      files: ["report.pdf"],
      options: ["Large"],
    });
  });

  it("writes a long selector on one line, as the released recorder does", async () => {
    const selector =
      'internal:role=button[name="Add the selected item to the shopping cart and continue to the checkout page"i]';
    const timeline = await clicked({ before: idle, after: idle, selector });

    expect(await timeline.package(header)).toContain(
      `          targetSelector: ${selector}\n`
    );
  });

  it("writes the tree of an empty page as an empty list", async () => {
    const timeline = await clicked({ before: "", after: idle });

    expect(await timeline.package(header)).toContain(
      lines(
        `    cause: initial`,
        `    baselineTree: []`,
        `    timelineEntries:`,
        `      - kind: interaction`
      )
    );
  });

  it("writes no property of a node, such as a link's address, in a Visit's first tree or in a Change Tree", async () => {
    const timeline = await clicked({
      before: page(`- link "Cart" [ref=e2]:`, `  - /url: /cart`),
      after: page(
        `- link "Cart" [ref=e2]:`,
        `  - /url: /cart`,
        `- link "Help" [ref=e3]:`,
        `  - /url: /help`
      ),
    });

    const text = await timeline.package(header);
    expect(text).toContain(
      lines(
        `    baselineTree:`,
        `      - [ref=e1]:`,
        `        - [ref=e2] link "Cart"`,
        `    timelineEntries:`
      )
    );
    expect(text).toContain(
      lines(
        `        changeTree:`,
        `          - [ref=e1]:`,
        `            - <added> [ref=e3] link "Help"`,
        `traceActionPoints: []`
      )
    );
  });

  it("writes a node on the way to a change without the text it holds itself", async () => {
    const timeline = await clicked({
      before: page(
        `- listitem [ref=e2]:`,
        `  - text: Milk`,
        `  - button "Remove" [ref=e3]`
      ),
      after: page(
        `- listitem [ref=e2]:`,
        `  - text: Milk`,
        `  - button "Remove" [disabled] [ref=e3]`
      ),
    });

    expect(await timeline.package(header)).toContain(
      lines(
        `        changeTree:`,
        `          - [ref=e1]:`,
        `            - [ref=e2] listitem:`,
        `              - <changed> [ref=e3] button "Remove" [disabled]`,
        `traceActionPoints: []`
      )
    );
  });
});
