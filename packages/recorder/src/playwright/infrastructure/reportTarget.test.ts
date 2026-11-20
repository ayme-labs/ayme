import { describe, expect, it } from "vitest";

import { pictureRef } from "../../timeline/domain";
import { reportTarget, type InputNote } from "./reportTarget";

// Playwright's picture of the page at a click: the link lists, the icon
// inside it does not.
const tree = [
  `- generic [ref=e1]:`,
  `  - link "Docs" [ref=e2]`,
  `  - button "Save" [ref=e3]`,
].join("\n");
const click = (ref: string) => ({ name: "click", ref, ariaSnapshot: tree });
const note = (under: string, ...chain: string[]): InputNote => ({
  type: "click",
  chain,
  under,
});

describe("the element a report's input acted on", () => {
  it("is the one its own note names: the note whose element under the pointer is the one Playwright's ref names", () => {
    expect(
      reportTarget(click("e2"), [note("e3", "e3"), note("e2", "e2", "e1")])
    ).toEqual({
      target: { ref: pictureRef("e2"), tree },
      fromSelector: false,
    });
  });

  it("is read through the selector for a click whose own note has not come, keeping Playwright's ref", () => {
    expect(reportTarget(click("e2"), [note("e3", "e3")])).toEqual({
      fromSelector: true,
    });
  });

  it("is never another click's, for a click on an element the picture does not list whose own note has not come: it is read through the selector", () => {
    expect(reportTarget(click("e9"), [note("e3", "e3")])).toEqual({
      target: { ref: null, tree, ancestors: [] },
      fromSelector: true,
    });
  });

  it("is its own note's, for a click on an element the picture does not list: the nearest ancestor the picture lists", () => {
    expect(
      reportTarget(click("e9"), [note("e3", "e3"), note("e9", "e9", "e2")])
    ).toEqual({
      target: { ref: null, tree, ancestors: [pictureRef("e2")] },
      fromSelector: true,
    });
  });

  it("names only the ancestors the picture lists, nearest first", () => {
    expect(
      reportTarget(click("e9"), [note("e9", "e9", "e8", "e2", "e1")])
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
    const key: InputNote = { type: "keydown", chain: ["e3"], under: "e2" };

    expect(reportTarget(click("e2"), [key])).toEqual({ fromSelector: true });
  });

  it("takes no click's note for a report of a kind no note is of", () => {
    expect(
      reportTarget({ name: "navigate", ref: "e2", ariaSnapshot: tree }, [
        note("e2", "e3"),
      ])
    ).toEqual({ fromSelector: false });
  });

  it("keeps the report's own target when the report has no picture", () => {
    expect(
      reportTarget({ name: "click", ref: "e2" }, [note("e2", "e2")])
    ).toEqual({ fromSelector: false });
  });
});
