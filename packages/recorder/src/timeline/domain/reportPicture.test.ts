import { describe, expect, it } from "vitest";

import type { TimelineAddition } from "./recorded";
import { Timeline } from "./timeline";

// How the report's own picture of the page is matched to the snapshots
// around an input the gate never holds, such as typing. The rules are read
// where they show: in the timeline's entries. Per input there is the snapshot
// before it, Playwright's picture at the moment of the input (numbered by
// itself), and the snapshot after it. What the picture already shows had
// changed before the input; the rest, the input changed.

/** A page: its elements under the one top-level node a snapshot has. */
const page = (...elements: string[]) =>
  [`- generic [ref=e1]:`, ...elements.map((line) => `  ${line}`)].join("\n");
/** Playwright's picture of a page: the same notation, with refs of its own. */
const picture = (...elements: string[]) =>
  [`- generic [ref=e20]:`, ...elements.map((line) => `  ${line}`)].join("\n");
/** A Change Tree's text, under the page's top-level node. */
const changed = (...lines: string[]) =>
  [`- [ref=e1]:`, ...lines.map((line) => `  ${line}`)].join("\n");

/** What the timeline makes of one input known from its report. */
async function read(input: {
  before: string;
  picture: string;
  after: string;
  /** The target's ref in the picture. */
  target: string | null;
  type?: string;
  /** What the page looked like earlier in the Visit, oldest first. */
  earlier?: string[];
  /** Playwright's selector for the target; one of the page when not given. */
  selector?: string;
}) {
  const timeline = new Timeline();
  const additions: TimelineAddition[] = [
    {
      kind: "visit",
      page: "page_1",
      url: "http://shop.test/",
      cause: "initial",
    },
    ...(input.earlier ?? []).map((tree, index): TimelineAddition => ({
      kind: "snapshot",
      snapshot: {
        id: `earlier_${index + 1}`,
        page: "page_1",
        url: "http://shop.test/",
        at: index + 1,
        tree,
      },
    })),
    ...[input.before, input.after].map((tree, index): TimelineAddition => ({
      kind: "snapshot",
      snapshot: {
        id: `snapshot_${index + 1}`,
        page: "page_1",
        url: "http://shop.test/",
        at: 10 * (index + 1),
        tree,
      },
    })),
    {
      kind: "interaction",
      interaction: {
        page: "page_1",
        report: {
          type: input.type ?? "fill",
          selector: input.selector ?? "internal:role=textbox",
          target: { ref: input.target, tree: input.picture },
          values: {},
        },
        before: "snapshot_1",
        after: "snapshot_2",
        at: 15,
        beforeFromReport: true,
      },
    },
  ];
  for (const addition of additions) await timeline.add(addition);
  const entries = timeline.visits()[0]!.entries;
  const interaction = entries.at(-1)!;
  if (interaction.kind !== "interaction") throw new Error("No Interaction.");
  return {
    /** The change written ahead of the input; null when there is none. */
    changedBefore: entries.length === 1 ? null : entries[0]!.changeTree,
    changedByIt: interaction.changeTree,
    targetRef: interaction.interaction.targetRef,
    warnings: timeline.warnings().map((warning) => warning.kind),
  };
}

describe("the report's picture, matched to the snapshots around an input", () => {
  it("credits the input with an element only the later snapshot has, when the picture does not show it", async () => {
    expect(
      await read({
        before: page(`- textbox "Item" [ref=e2]`),
        picture: picture(`- textbox "Item" [ref=e21]: m`),
        after: page(
          `- textbox "Item" [ref=e2]: milk`,
          `- status [ref=e3]: Draft saved`
        ),
        target: "e21",
      })
    ).toEqual({
      changedBefore: null,
      changedByIt: changed(
        `- <changed> [ref=e2] textbox "Item": milk`,
        `- <added> [ref=e3] status: Draft saved`
      ),
      targetRef: "e2",
      warnings: [],
    });
  });

  it("writes an element that was gone by the moment of the input as removed before it", async () => {
    expect(
      await read({
        before: page(
          `- textbox "Item" [ref=e2]`,
          `- alert [ref=e3]: Welcome back`
        ),
        picture: picture(`- textbox "Item" [ref=e21]: m`),
        after: page(`- textbox "Item" [ref=e2]: milk`),
        target: "e21",
      })
    ).toEqual({
      changedBefore: changed(`- <removed> [ref=e3] alert: Welcome back`),
      changedByIt: changed(`- <changed> [ref=e2] textbox "Item": milk`),
      targetRef: "e2",
      warnings: [],
    });
  });

  it("credits the input with removing an element the picture still shows", async () => {
    expect(
      await read({
        before: page(
          `- textbox "Item" [ref=e2]`,
          `- alert [ref=e3]: Welcome back`
        ),
        picture: picture(
          `- textbox "Item" [ref=e21]: m`,
          `- alert [ref=e22]: Welcome back`
        ),
        after: page(`- textbox "Item" [ref=e2]: milk`),
        target: "e21",
      })
    ).toEqual({
      changedBefore: null,
      changedByIt: changed(
        `- <changed> [ref=e2] textbox "Item": milk`,
        `- <removed> [ref=e3] alert: Welcome back`
      ),
      targetRef: "e2",
      warnings: [],
    });
  });

  describe("among elements that look alike", () => {
    it("takes the one both snapshots have, not a new one the later snapshot lists ahead of it", async () => {
      expect(
        await read({
          before: page(
            `- listitem [ref=e2]: Milk`,
            `- textbox "Item" [ref=e3]`
          ),
          // One "Milk" at the moment of the input: the second came with it.
          picture: picture(
            `- listitem [ref=e21]: Milk`,
            `- textbox "Item" [ref=e22]: m`
          ),
          after: page(
            `- listitem [ref=e4]: Milk`,
            `- listitem [ref=e2]: Milk`,
            `- textbox "Item" [ref=e3]: milk`
          ),
          target: "e22",
        })
      ).toEqual({
        changedBefore: null,
        changedByIt: changed(
          `- <added> [ref=e4] listitem: Milk`,
          `- <changed> [ref=e3] textbox "Item": milk`
        ),
        targetRef: "e3",
        warnings: [],
      });
    });

    it("takes the one both snapshots have, not one that was gone, listed ahead of it", async () => {
      expect(
        await read({
          before: page(
            `- listitem [ref=e2]: Milk`,
            `- listitem [ref=e3]: Milk`,
            `- textbox "Item" [ref=e4]`
          ),
          // One "Milk" at the moment of the input: the other was gone by then.
          picture: picture(
            `- listitem [ref=e21]: Milk`,
            `- textbox "Item" [ref=e22]: m`
          ),
          after: page(
            `- listitem [ref=e3]: Milk`,
            `- textbox "Item" [ref=e4]: milk`
          ),
          target: "e22",
        })
      ).toEqual({
        changedBefore: changed(`- <removed> [ref=e2] listitem: Milk`),
        changedByIt: changed(`- <changed> [ref=e4] textbox "Item": milk`),
        targetRef: "e4",
        warnings: [],
      });
    });
  });

  describe("among elements that look alike, when none is in both snapshots", () => {
    it("takes one the earlier snapshot has, not a new one the later snapshot lists ahead of it", async () => {
      // One "Milk" before the input and at its moment: nothing had changed.
      // The page then put two new ones in its place.
      expect(
        await read({
          before: page(
            `- listitem [ref=e2]: Milk`,
            `- textbox "Item" [ref=e3]`
          ),
          picture: picture(
            `- listitem [ref=e21]: Milk`,
            `- textbox "Item" [ref=e22]: m`
          ),
          after: page(
            `- listitem [ref=e4]: Milk`,
            `- listitem [ref=e5]: Milk`,
            `- textbox "Item" [ref=e3]: milk`
          ),
          target: "e22",
        })
      ).toEqual({
        changedBefore: null,
        changedByIt: changed(
          `- <added> [ref=e4] listitem: Milk`,
          `- <added> [ref=e5] listitem: Milk`,
          `- <removed> [ref=e2] listitem: Milk`,
          `- <changed> [ref=e3] textbox "Item": milk`
        ),
        targetRef: "e3",
        warnings: [],
      });
    });
  });

  it("credits the input with replacing two elements that look alike by a new one: none of the three is another's successor", async () => {
    // Core cannot tell which of the two the new one would be, so it is
    // neither: both were there at the moment of the input, and are gone.
    expect(
      await read({
        before: page(
          `- listitem [ref=e2]: Milk`,
          `- listitem [ref=e3]: Milk`,
          `- textbox "Item" [ref=e4]`
        ),
        picture: picture(
          `- listitem [ref=e21]: Milk`,
          `- listitem [ref=e22]: Milk`,
          `- textbox "Item" [ref=e23]: m`
        ),
        after: page(
          `- listitem [ref=e5]: Milk`,
          `- textbox "Item" [ref=e4]: milk`
        ),
        target: "e23",
      })
    ).toEqual({
      changedBefore: null,
      changedByIt: changed(
        `- <added> [ref=e5] listitem: Milk`,
        `- <removed> [ref=e2] listitem: Milk`,
        `- <removed> [ref=e3] listitem: Milk`,
        `- <changed> [ref=e4] textbox "Item": milk`
      ),
      targetRef: "e4",
      warnings: [],
    });
  });

  it("credits the input with putting one element in the place of another that looks like it, when the recording has seen the two side by side", async () => {
    // Two "Milk" earlier on; the page showed one of them before the input
    // and at its moment, and shows the other one after it.
    expect(
      await read({
        earlier: [
          page(
            `- listitem [ref=e2]: Milk`,
            `- listitem [ref=e3]: Milk`,
            `- textbox "Item" [ref=e4]`
          ),
        ],
        before: page(`- listitem [ref=e2]: Milk`, `- textbox "Item" [ref=e4]`),
        picture: picture(
          `- listitem [ref=e21]: Milk`,
          `- textbox "Item" [ref=e22]: m`
        ),
        after: page(
          `- listitem [ref=e3]: Milk`,
          `- textbox "Item" [ref=e4]: milk`
        ),
        target: "e22",
      })
    ).toEqual({
      changedBefore: null,
      changedByIt: changed(
        `- <added> [ref=e3] listitem: Milk`,
        `- <removed> [ref=e2] listitem: Milk`,
        `- <changed> [ref=e4] textbox "Item": milk`
      ),
      targetRef: "e4",
      warnings: [],
    });
  });

  it("takes the target of an input that is neither typing nor a choice as the picture shows it", async () => {
    // The list had finished loading when the file was chosen.
    expect(
      await read({
        before: page(
          `- group "Attachments" [ref=e2]:`,
          `  - paragraph [ref=e3]: Loading`
        ),
        picture: picture(
          `- group "Attachments" [ref=e21]:`,
          `  - paragraph [ref=e22]: No file yet`
        ),
        after: page(
          `- group "Attachments" [ref=e2]:`,
          `  - paragraph [ref=e3]: report.pdf`
        ),
        target: "e21",
        type: "setInputFiles",
      })
    ).toEqual({
      changedBefore: changed(
        `- [ref=e2] group "Attachments":`,
        `  - <changed> [ref=e3] paragraph: No file yet`
      ),
      changedByIt: changed(
        `- [ref=e2] group "Attachments":`,
        `  - <changed> [ref=e3] paragraph: report.pdf`
      ),
      targetRef: "e2",
      warnings: [],
    });
  });

  describe("an element only the picture has", () => {
    it("gets a ref of its own, beside one whose text the input changed: there before the input, gone after it", async () => {
      const result = await read({
        before: page(
          `- textbox "Item" [ref=e2]`,
          `- paragraph [ref=e3]: No draft`
        ),
        // "Saving" shows only while the person types.
        picture: picture(
          `- textbox "Item" [ref=e21]: m`,
          `- paragraph [ref=e22]: Saving`,
          `- paragraph [ref=e23]: No draft`
        ),
        after: page(
          `- textbox "Item" [ref=e2]: milk`,
          `- paragraph [ref=e3]: Draft saved`,
          `- alert [ref=e4]: Saved`
        ),
        target: "e21",
      });

      const [, own] = /<added> \[ref=(s_\d+)\] paragraph: Saving/.exec(
        result.changedBefore ?? ""
      )!;
      expect(result).toEqual({
        changedBefore: changed(`- <added> [ref=${own}] paragraph: Saving`),
        changedByIt: changed(
          `- <changed> [ref=e2] textbox "Item": milk`,
          `- <removed> [ref=${own}] paragraph: Saving`,
          `- <changed> [ref=e3] paragraph: Draft saved`,
          `- <added> [ref=e4] alert: Saved`
        ),
        targetRef: "e2",
        warnings: [],
      });
    });

    it("is not taken for a new element of the same role and another name", async () => {
      const result = await read({
        before: page(`- textbox "Item" [ref=e2]`),
        picture: picture(
          `- textbox "Item" [ref=e21]: m`,
          `- button "Undo" [ref=e22]`
        ),
        after: page(
          `- textbox "Item" [ref=e2]: milk`,
          `- button "Redo" [ref=e3]`
        ),
        target: "e21",
      });

      const [, own] = /<added> \[ref=(s_\d+)\] button "Undo"/.exec(
        result.changedBefore ?? ""
      )!;
      expect(result).toEqual({
        changedBefore: changed(`- <added> [ref=${own}] button "Undo"`),
        changedByIt: changed(
          `- <changed> [ref=e2] textbox "Item": milk`,
          `- <added> [ref=e3] button "Redo"`,
          `- <removed> [ref=${own}] button "Undo"`
        ),
        targetRef: "e2",
        warnings: [],
      });
    });
  });

  it("knows an element by its role and name when its text at the moment of the input is neither snapshot's", async () => {
    expect(
      await read({
        before: page(
          `- textbox "Item" [ref=e2]`,
          `- paragraph [ref=e3]: 0 characters`
        ),
        picture: picture(
          `- textbox "Item" [ref=e21]: m`,
          `- paragraph [ref=e22]: 1 character`
        ),
        after: page(
          `- textbox "Item" [ref=e2]: milk`,
          `- paragraph [ref=e3]: 4 characters`
        ),
        target: "e21",
      })
    ).toEqual({
      changedBefore: changed(`- <changed> [ref=e3] paragraph: 1 character`),
      changedByIt: changed(
        `- <changed> [ref=e2] textbox "Item": milk`,
        `- <changed> [ref=e3] paragraph: 4 characters`
      ),
      targetRef: "e2",
      warnings: [],
    });
  });

  describe("the target of typing or of a choice, reported once it has changed", () => {
    it("stands as the earlier snapshot has it, also when the input left it as it was", async () => {
      expect(
        await read({
          before: page(`- textbox "Item" [ref=e2]: milk`),
          picture: picture(`- textbox "Item" [ref=e21]: mil`),
          after: page(`- textbox "Item" [ref=e2]: milk`),
          target: "e21",
        })
      ).toEqual({
        changedBefore: null,
        changedByIt: null,
        targetRef: "e2",
        warnings: [],
      });
    });

    it("stands with everything in it as the earlier snapshot has it: a choice changes its options", async () => {
      const result = await read({
        before: page(
          `- combobox "Size" [ref=e2]:`,
          `  - option "Small" [selected]`,
          `  - option "Large"`
        ),
        picture: picture(
          `- combobox "Size" [ref=e21]:`,
          `  - option "Small"`,
          `  - option "Large" [selected]`
        ),
        after: page(
          `- combobox "Size" [ref=e2]:`,
          `  - option "Small"`,
          `  - option "Large" [selected]`
        ),
        target: "e21",
        type: "select",
      });

      expect(result).toMatchObject({
        changedBefore: null,
        targetRef: "e2",
        warnings: [],
      });
      expect(result.changedByIt).toMatch(
        /^- \[ref=e1\]:\n {2}- \[ref=e2\] combobox "Size":\n {4}- <changed> \[ref=s_\d+\] option "Small"\n {4}- <changed> \[ref=s_\d+\] option "Large" \[selected\]$/
      );
    });

    it("stands as the earlier snapshot has it, under its first ref, when the page re-created it meanwhile", async () => {
      expect(
        await read({
          before: page(`- textbox "Item" [ref=e2]`),
          picture: picture(`- textbox "Item" [ref=e21]: m`),
          // Playwright names the new element e5.
          after: page(`- textbox "Item" [ref=e5]: milk`),
          target: "e21",
        })
      ).toEqual({
        changedBefore: null,
        changedByIt: changed(`- <changed> [ref=e2] textbox "Item": milk`),
        targetRef: "e2",
        warnings: [],
      });
    });

    it("is written as it was at the moment of the input when the earlier snapshot does not have it", async () => {
      expect(
        await read({
          before: page(`- button "Add a row" [ref=e2]`),
          picture: picture(
            `- button "Add a row" [ref=e21]`,
            `- textbox "Item" [ref=e22]: m`
          ),
          after: page(
            `- button "Add a row" [ref=e2]`,
            `- textbox "Item" [ref=e3]: milk`
          ),
          target: "e22",
        })
      ).toEqual({
        changedBefore: changed(`- <added> [ref=e3] textbox "Item": m`),
        changedByIt: changed(`- <changed> [ref=e3] textbox "Item": milk`),
        targetRef: "e3",
        warnings: [],
      });
    });
  });

  describe("a frame in the page", () => {
    const frame = (...elements: string[]) => [
      `- iframe [ref=e3]:`,
      `  - generic [ref=f1e1]:`,
      ...elements.map((line) => `    ${line}`),
    ];

    const inFrame =
      "iframe >> internal:control=enter-frame >> internal:role=textbox";

    it("is read in a frame of a frame when Playwright's selector starts by any frame, as from 1.63 it does that deep", async () => {
      const nested = (field: string) =>
        page(
          `- textbox "Item" [ref=e2]`,
          `- iframe [ref=e3]:`,
          `  - generic [ref=f1e1]:`,
          `    - button "Back" [ref=f1e2]`,
          `    - iframe [ref=f1e3]:`,
          `      - generic [ref=f2e1]:`,
          `        - textbox "Item" [ref=f2e2]${field}`
        );

      expect(
        await read({
          before: nested(""),
          picture: picture(`- textbox "Item" [ref=e21]: m`),
          after: nested(": milk"),
          target: "e21",
          selector: "internal:control=any-frame >> internal:role=textbox",
        })
      ).toEqual({
        changedBefore: null,
        changedByIt: changed(
          `- [ref=e3] iframe:`,
          `  - [ref=f1e1]:`,
          `    - [ref=f1e3] iframe:`,
          `      - [ref=f2e1]:`,
          `        - <changed> [ref=f2e2] textbox "Item": milk`
        ),
        targetRef: "f2e2",
        warnings: [],
      });
    });

    it("is not read from a picture that two frames both fit: the input's target is not known, it is written with its 'after' only, and warned of", async () => {
      const card = (number: number, field: string) => [
        `- iframe [ref=e${number + 1}]:`,
        `  - generic [ref=f${number}e1]:`,
        `    - textbox "Card number" [ref=f${number}e2]${field}`,
      ];

      expect(
        await read({
          before: page(...card(1, ""), ...card(2, "")),
          // Of the frame the person typed in, which looks like the other.
          picture: [
            `- generic [ref=e20]:`,
            `  - textbox "Card number" [ref=e21]: 4`,
          ].join("\n"),
          after: page(...card(1, ""), ...card(2, ": 4242")),
          target: "e21",
          selector: inFrame,
        })
      ).toEqual({
        changedBefore: null,
        changedByIt: changed(
          `- [ref=e3] iframe:`,
          `  - [ref=f2e1]:`,
          `    - <changed> [ref=f2e2] textbox "Card number": 4242`
        ),
        targetRef: null,
        warnings: ["reportShape"],
      });
    });

    it("is not looked into for a picture of the page: an input in the page is not read as one in a frame that looks like the page", async () => {
      expect(
        await read({
          before: page(
            `- iframe [ref=e3]:`,
            `  - generic [ref=f1e1]:`,
            `    - textbox "Item" [ref=f1e2]`
          ),
          // Not of this page: it shows no frame. The selector is the page's.
          picture: picture(`- textbox "Item" [ref=e21]: m`),
          after: page(
            `- iframe [ref=e3]:`,
            `  - generic [ref=f1e1]:`,
            `    - textbox "Item" [ref=f1e2]: milk`
          ),
          target: "e21",
        })
      ).toMatchObject({ targetRef: null, warnings: ["reportShape"] });
    });

    it("stands as the earlier snapshot has it for an input in the page: the picture never holds what is in a frame", async () => {
      expect(
        await read({
          before: page(
            `- textbox "Item" [ref=e2]`,
            ...frame(`- button "Pay" [ref=f1e2]`)
          ),
          picture: picture(
            `- textbox "Item" [ref=e21]: m`,
            `- iframe [ref=e22]`
          ),
          after: page(
            `- textbox "Item" [ref=e2]: milk`,
            ...frame(`- button "Pay" [ref=f1e2]`)
          ),
          target: "e21",
        })
      ).toEqual({
        changedBefore: null,
        changedByIt: changed(`- <changed> [ref=e2] textbox "Item": milk`),
        targetRef: "e2",
        warnings: [],
      });
    });

    it("is written as added before the input when the picture shows a frame the earlier snapshot does not have", async () => {
      const result = await read({
        before: page(`- textbox "Item" [ref=e2]`),
        picture: picture(`- textbox "Item" [ref=e21]: m`, `- iframe [ref=e22]`),
        after: page(
          `- textbox "Item" [ref=e2]: milk`,
          ...frame(`- button "Pay" [ref=f1e2]`)
        ),
        target: "e21",
      });

      expect(result).toMatchObject({
        changedBefore: changed(`- <added> [ref=e3] iframe`),
        targetRef: "e2",
        warnings: [],
      });
    });

    it("takes what changed in a frame before an input in that frame from the picture, which is of the frame alone", async () => {
      expect(
        await read({
          before: page(
            `- heading "Shop" [level=1] [ref=e2]`,
            ...frame(`- textbox "Item" [ref=f1e2]`),
            `- paragraph [ref=e4]: Empty`
          ),
          picture: [
            `- generic [ref=e20]:`,
            `  - alert [ref=e21]: Welcome back`,
            `  - textbox "Item" [ref=e22]: m`,
          ].join("\n"),
          after: page(
            `- heading "Shop" [level=1] [ref=e2]`,
            ...frame(
              `- alert [ref=f1e3]: Welcome back`,
              `- textbox "Item" [ref=f1e2]: milk`
            ),
            `- paragraph [ref=e4]: Draft saved`
          ),
          target: "e22",
          selector: inFrame,
        })
      ).toEqual({
        changedBefore: changed(
          `- [ref=e3] iframe:`,
          `  - [ref=f1e1]:`,
          `    - <added> [ref=f1e3] alert: Welcome back`
        ),
        changedByIt: changed(
          `- [ref=e3] iframe:`,
          `  - [ref=f1e1]:`,
          `    - <changed> [ref=f1e2] textbox "Item": milk`,
          `- <changed> [ref=e4] paragraph: Draft saved`
        ),
        targetRef: "f1e2",
        warnings: [],
      });
    });
  });

  it("is not of the shape of a snapshot with a top-level node more than the page has: the input is written with its 'after' only, and warned of", async () => {
    expect(
      await read({
        before: page(`- textbox "Item" [ref=e2]`),
        picture: [
          picture(`- textbox "Item" [ref=e21]: m`),
          `- dialog [ref=e22]: Sign in`,
        ].join("\n"),
        after: page(`- textbox "Item" [ref=e2]: milk`),
        target: "e21",
      })
    ).toEqual({
      changedBefore: null,
      changedByIt: changed(`- <changed> [ref=e2] textbox "Item": milk`),
      targetRef: null,
      warnings: ["reportShape"],
    });
  });
});
