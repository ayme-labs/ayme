import { describe, expect, it } from "vitest";

import type { TimelineAddition } from "./recorded";
import { Timeline } from "./timeline";

// Which element of a snapshot a report's target is. Playwright's report names
// the target in its own picture of the page; the timeline finds the node at
// the same place in the snapshot taken just before the input: in the page, or
// in the frame whose top level is the picture's.

/** The target ref the timeline gives a click, held by the gate, on a page
 * that looks like `before`, whose report names `ref` in `picture`. */
async function targetOf(input: {
  before: string;
  picture: string;
  ref: string | null;
  ancestors?: string[];
  /** Playwright's selector for the target; one of the page when not given. */
  selector?: string | null;
}) {
  const timeline = new Timeline();
  const additions: TimelineAddition[] = [
    {
      kind: "visit",
      page: "page_1",
      url: "http://shop.test/",
      cause: "initial",
    },
    ...["snapshot_1", "snapshot_2"].map((id, index): TimelineAddition => ({
      kind: "snapshot",
      snapshot: {
        id,
        page: "page_1",
        url: "http://shop.test/",
        at: 10 * (index + 1),
        tree: input.before,
      },
    })),
    {
      kind: "interaction",
      interaction: {
        page: "page_1",
        report: {
          type: "click",
          selector:
            input.selector === undefined
              ? "internal:role=button"
              : input.selector,
          target: {
            ref: input.ref,
            tree: input.picture,
            ...(input.ancestors ? { ancestors: input.ancestors } : {}),
          },
          values: {},
        },
        before: "snapshot_1",
        after: "snapshot_2",
        at: 15,
      },
    },
  ];
  for (const addition of additions) await timeline.add(addition);
  const [entry] = timeline.visits()[0]!.entries;
  if (entry?.kind !== "interaction") throw new Error("No Interaction.");
  return entry.interaction.targetRef;
}

const lines = (...all: string[]) => all.join("\n");

describe("the target a report names", () => {
  it("is not known when its node in the snapshot has the role and another name", async () => {
    expect(
      await targetOf({
        before: lines(`- generic [ref=e1]:`, `  - button "Save" [ref=e2]`),
        picture: lines(`- generic [ref=e20]:`, `  - button "Delete" [ref=e21]`),
        ref: "e21",
      })
    ).toBeNull();
  });

  it("is not known when the report names a ref its own picture does not have", async () => {
    const before = lines(`- generic [ref=e1]:`, `  - button "Save" [ref=e2]`);

    expect(await targetOf({ before, picture: before, ref: "e99" })).toBeNull();
  });

  it("is its nearest ancestor that the picture lists, passing over one it does not", async () => {
    expect(
      await targetOf({
        before: lines(
          `- generic [ref=e1]:`,
          `  - group "Actions" [ref=e2]:`,
          `    - button "Save" [ref=e3]`
        ),
        picture: lines(
          `- generic [ref=e20]:`,
          `  - group "Actions" [ref=e21]:`,
          `    - button "Save" [ref=e22]`
        ),
        // The icon in the button, and a wrapper around it, are not listed.
        ref: null,
        ancestors: ["e30", "e22", "e21"],
      })
    ).toBe("e3");
  });

  it("is not looked for inside an element of the page that is no frame, though its content is the picture's", async () => {
    expect(
      await targetOf({
        before: lines(
          `- generic [ref=e1]:`,
          `  - generic [ref=e2]:`,
          `    - button "Save" [ref=e3]`
        ),
        picture: lines(`- generic [ref=e20]:`, `  - button "Save" [ref=e21]`),
        ref: "e21",
      })
    ).toBeNull();
  });

  // Playwright's selector says which document the input was given to: one
  // that enters a frame names the frame first. The target is looked for in
  // that document only: a ref a reader trusts is never a look-alike's.
  describe("in a frame", () => {
    const inFrame =
      'iframe >> internal:control=enter-frame >> internal:role=button[name="Pay"i]';
    /** A page with a "Pay" button of its own, and frames that hold one too. */
    const withFrames = (...frames: string[][]) =>
      lines(
        `- generic [ref=e1]:`,
        `  - button "Pay" [ref=e2]`,
        ...frames.flat()
      );
    const frame = (number: number, top = "generic") => [
      `  - iframe [ref=e${number + 2}]:`,
      `    - ${top} [ref=f${number}e1]:`,
      `      - button "Pay" [ref=f${number}e2]`,
    ];
    const ofFrame = lines(`- generic [ref=e20]:`, `  - button "Pay" [ref=e21]`);

    it("is the frame's element for an input in the frame, though the page has one like it at the same place", async () => {
      expect(
        await targetOf({
          before: withFrames(frame(1)),
          picture: ofFrame,
          ref: "e21",
          selector: inFrame,
        })
      ).toBe("f1e2");
    });

    it("is the page's element for an input in the page, though a frame has one like it at the same place", async () => {
      expect(
        await targetOf({
          before: withFrames(frame(1)),
          picture: ofFrame,
          ref: "e21",
          selector: 'internal:role=button[name="Pay"i]',
        })
      ).toBe("e2");
    });

    it("is not known for an input in the page whose target is at that place in a frame only", async () => {
      expect(
        await targetOf({
          before: lines(
            `- generic [ref=e1]:`,
            `  - iframe [ref=e3]:`,
            `    - group [ref=f1e1]:`,
            `      - button "Pay" [ref=f1e2]`
          ),
          picture: lines(`- group [ref=e20]:`, `  - button "Pay" [ref=e21]`),
          ref: "e21",
          selector: 'internal:role=button[name="Pay"i]',
        })
      ).toBeNull();
    });

    it("is found in the frame whose top level is the picture's when the frames differ at the top", async () => {
      expect(
        await targetOf({
          before: withFrames(frame(1, "group"), frame(2, `main "Card"`)),
          picture: lines(
            `- main "Card" [ref=e20]:`,
            `  - button "Pay" [ref=e21]`
          ),
          ref: "e21",
          selector: inFrame,
        })
      ).toBe("f2e2");
    });

    it("is found in the frame whose top level is the picture's when the frames differ at the top by name only", async () => {
      expect(
        await targetOf({
          before: withFrames(frame(1, `main "Shop"`), frame(2, `main "Card"`)),
          picture: lines(
            `- main "Card" [ref=e20]:`,
            `  - button "Pay" [ref=e21]`
          ),
          ref: "e21",
          selector: inFrame,
        })
      ).toBe("f2e2");
    });

    it("is not known when two frames both have it: which of them the input was given to cannot be told", async () => {
      expect(
        await targetOf({
          before: withFrames(frame(1), frame(2)),
          picture: ofFrame,
          ref: "e21",
          selector: inFrame,
        })
      ).toBeNull();
    });

    it("is looked for as deep as the selector enters frames: in a frame of a frame, not in the frame around it", async () => {
      expect(
        await targetOf({
          before: lines(
            `- generic [ref=e1]:`,
            `  - iframe [ref=e2]:`,
            `    - generic [ref=f1e1]:`,
            `      - button "Pay" [ref=f1e2]`,
            `      - iframe [ref=f1e3]:`,
            `        - generic [ref=f2e1]:`,
            `          - button "Pay" [ref=f2e2]`
          ),
          picture: ofFrame,
          ref: "e21",
          selector: `iframe >> internal:control=enter-frame >> ${inFrame}`,
        })
      ).toBe("f2e2");
    });

    it("is not known for a report with no selector: nothing says which document the input was given to", async () => {
      expect(
        await targetOf({
          before: withFrames(frame(1)),
          picture: ofFrame,
          ref: "e21",
          selector: null,
        })
      ).toBeNull();
    });
  });

  describe("on a page with more than one node at the top", () => {
    const before = lines(
      `- generic [ref=e1]:`,
      `  - button "Save" [ref=e2]`,
      `- alert [ref=e3]: Saved`
    );

    it("is found when the picture's top level is the page's", async () => {
      expect(
        await targetOf({
          before,
          picture: lines(
            `- generic [ref=e20]:`,
            `  - button "Save" [ref=e21]`,
            `- alert [ref=e22]: Saved`
          ),
          ref: "e21",
        })
      ).toBe("e2");
    });

    it("is not known when one node of the picture's top level is another", async () => {
      expect(
        await targetOf({
          before,
          picture: lines(
            `- generic [ref=e20]:`,
            `  - button "Save" [ref=e21]`,
            `- dialog [ref=e22]: Saved`
          ),
          ref: "e21",
        })
      ).toBeNull();
    });

    it("is not known when the picture's top level has a node less", async () => {
      expect(
        await targetOf({
          before,
          picture: lines(`- generic [ref=e20]:`, `  - button "Save" [ref=e21]`),
          ref: "e21",
        })
      ).toBeNull();
    });
  });
});
