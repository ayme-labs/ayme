import { describe, expect, it } from "vitest";

import { pictureRef } from "../../timeline/domain";
import type { HeldClick } from "./pageRules";
import {
  reportedClick,
  reportTarget,
  sentOn,
  type AwaitedClick,
  type InputNote,
} from "./reportTarget";

// Playwright's picture of the page at a click: the link lists, the icon
// inside it does not.
const tree = [
  `- generic [ref=e1]:`,
  `  - link "Docs" [ref=e2]`,
  `  - button "Save" [ref=e3]`,
].join("\n");
const click = (ref: string) => ({ name: "click", ref, ariaSnapshot: tree });
// A note of a click no page held.
const note = (under: string, ...chain: string[]): InputNote => ({
  type: "click",
  chain,
  under,
  held: null,
});
/** The `seq`th click the document "doc" held. */
const held = (seq: number): HeldClick => ({ document: "doc", seq });

describe("the element a report's input acted on", () => {
  it("is the one its own note names: the note whose element under the pointer is the one Playwright's ref names", () => {
    expect(
      reportTarget(
        click("e2"),
        [note("e3", "e3"), note("e2", "e2", "e1")],
        null
      )
    ).toEqual({
      target: { ref: pictureRef("e2"), tree },
      fromSelector: false,
    });
  });

  it("is read through the selector for a click whose own note has not come, keeping Playwright's ref", () => {
    expect(reportTarget(click("e2"), [note("e3", "e3")], null)).toEqual({
      fromSelector: true,
    });
  });

  it("is never another click's, for a click on an element the picture does not list whose own note has not come: it is read through the selector", () => {
    expect(reportTarget(click("e9"), [note("e3", "e3")], null)).toEqual({
      target: { ref: null, tree, ancestors: [] },
      fromSelector: true,
    });
  });

  it("is its own note's, for a click on an element the picture does not list: the nearest ancestor the picture lists", () => {
    expect(
      reportTarget(
        click("e9"),
        [note("e3", "e3"), note("e9", "e9", "e2")],
        null
      )
    ).toEqual({
      target: { ref: null, tree, ancestors: [pictureRef("e2")] },
      fromSelector: true,
    });
  });

  it("names only the ancestors the picture lists, nearest first", () => {
    expect(
      reportTarget(click("e9"), [note("e9", "e9", "e8", "e2", "e1")], null)
    ).toEqual({
      target: {
        ref: null,
        tree,
        ancestors: [pictureRef("e2"), pictureRef("e1")],
      },
      fromSelector: true,
    });
  });

  it("takes only a note of an event a report of its kind is of: a key's note is no click's", () => {
    const key: InputNote = {
      type: "keydown",
      chain: ["e3"],
      under: "e2",
      held: null,
    };

    expect(reportTarget(click("e2"), [key], null)).toEqual({
      fromSelector: true,
    });
  });

  it("takes no click's note for a report of a kind no note is of", () => {
    expect(
      reportTarget(
        { name: "navigate", ref: "e2", ariaSnapshot: tree },
        [note("e2", "e3")],
        null
      )
    ).toEqual({ fromSelector: false });
  });

  it("keeps the report's own target when the report has no picture", () => {
    expect(
      reportTarget({ name: "click", ref: "e2" }, [note("e2", "e2")], null)
    ).toEqual({ fromSelector: false });
  });
});

describe("the element a held click's report names", () => {
  // The issue's page: a star clicked inside button A, which the page then
  // moved into button B, where it is clicked again.
  const moved = [
    `- generic [ref=e1]:`,
    `  - button "Alpha" [ref=e2]`,
    `  - button "Beta" [ref=e4]:`,
    `    - generic [ref=e3]: Star`,
  ].join("\n");
  const rightClick = { name: "click", ref: "e3", ariaSnapshot: moved };
  const inA: InputNote = {
    type: "click",
    chain: ["e2", "e1"],
    under: "e3",
    held: held(1),
  };

  it("is never an earlier click's, though its note names the same element under the pointer: a report that comes before its own note is read through the selector", () => {
    expect(reportTarget(rightClick, [inA], held(2))).toEqual({
      fromSelector: true,
    });
  });

  it("is its own click's note, once that has come", () => {
    const inB: InputNote = {
      type: "contextmenu",
      chain: ["e4", "e1"],
      under: "e3",
      held: held(2),
    };

    expect(reportTarget(rightClick, [inA, inB], held(2))).toEqual({
      target: { ref: pictureRef("e4"), tree: moved },
      fromSelector: false,
    });
  });

  it("takes no note of an event that is no held click's, as the release of the right-click, which reaches the page before the click is sent on", () => {
    const release: InputNote = {
      type: "auxclick",
      chain: ["e2", "e1"],
      under: "e3",
      held: null,
    };

    expect(reportTarget(rightClick, [release], held(2))).toEqual({
      fromSelector: true,
    });
  });

  it("takes no note of a click another document held under the same number", () => {
    const elsewhere: InputNote = {
      ...inA,
      held: { document: "gone", seq: 2 },
    };

    expect(reportTarget(rightClick, [elsewhere], held(2))).toEqual({
      fromSelector: true,
    });
  });

  it("is no held click's note for a click no page held", () => {
    expect(reportTarget(rightClick, [inA], null)).toEqual({
      fromSelector: true,
    });
  });
});

describe("the held click a report is of", () => {
  const sent = (seq: number, count = 1): AwaitedClick => ({
    ...held(seq),
    count,
  });

  it("awaits, of the clicks sent on before, only the last: Playwright holds back at most one click's report", () => {
    expect(sentOn([sent(1), sent(2)], sent(3))).toEqual([sent(2), sent(3)]);
  });

  it("is the oldest awaited click of its count: Playwright gives a click it held back with the next click's report", () => {
    expect(
      reportedClick([sent(1), sent(2)], { name: "click", clickCount: 1 })
    ).toEqual({ of: held(1), awaited: [sent(2)] });
  });

  it("is a double click's second click, for the one report Playwright gives of both, and the first is awaited no more", () => {
    expect(
      reportedClick([sent(1, 1), sent(2, 2)], { name: "click", clickCount: 2 })
    ).toEqual({ of: held(2), awaited: [] });
  });

  it("counts one for a check and an uncheck, which name no count", () => {
    expect(reportedClick([sent(1)], { name: "check" })).toEqual({
      of: held(1),
      awaited: [],
    });
  });

  it("is none, and leaves every click awaited, for a report of no awaited click", () => {
    expect(reportedClick([sent(1)], { name: "click", clickCount: 2 })).toEqual({
      of: null,
      awaited: [sent(1)],
    });
  });

  it("is none for a report of the keyboard", () => {
    expect(reportedClick([sent(1)], { name: "press" })).toEqual({
      of: null,
      awaited: [sent(1)],
    });
  });
});
