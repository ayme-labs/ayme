import { describe, expect, it } from "vitest";

import { heldByPageIn, inputNoteIn } from "./pageValues";

const click = {
  kind: "click",
  seq: 1,
  x: 10,
  y: 20,
  detail: 1,
  modifiers: [],
  document: "doc_1",
  untouched: false,
};
const key = {
  kind: "key",
  seq: 2,
  typing: true,
  nothingFocused: false,
  key: "a",
  code: "KeyA",
  modifiers: ["Shift"],
  document: "doc_1",
};

describe("what a page tells of an input it held", () => {
  it("is taken as the gate sends it: a click, with or without its button, held or untouched, or a key", () => {
    expect(heldByPageIn(click)).toEqual(click);
    expect(heldByPageIn({ ...click, untouched: true })).toEqual({
      ...click,
      untouched: true,
    });
    // A click from the keyboard counts 0, and a pointer can be between
    // pixels.
    expect(heldByPageIn({ ...click, detail: 0, x: 10.5, y: -2 })).toEqual({
      ...click,
      detail: 0,
      x: 10.5,
      y: -2,
    });
    expect(heldByPageIn({ ...click, button: "right" })).toEqual({
      ...click,
      button: "right",
    });
    expect(heldByPageIn(key)).toEqual(key);
  });

  it.each([
    ["nothing", null],
    ["an empty object", {}],
    ["a click with nothing but its kind", { kind: "click" }],
    ["a key with nothing but its kind", { kind: "key" }],
    ["another kind of input", { ...click, kind: "drag" }],
    ["a click with no number", { ...click, seq: "1" }],
    ["a click numbered NaN", { ...click, seq: NaN }],
    ["a click numbered 0, which the gate never gives", { ...click, seq: 0 }],
    ["a click with a negative number", { ...click, seq: -1 }],
    ["a click with a fractional number", { ...click, seq: 1.5 }],
    ["a click numbered past the safe integers", { ...click, seq: 2 ** 60 }],
    ["a click at NaN", { ...click, x: NaN }],
    ["a click at Infinity", { ...click, y: Infinity }],
    ["a click of a negative count", { ...click, detail: -1 }],
    ["a click of a fractional count", { ...click, detail: 0.5 }],
    ["a click of count Infinity", { ...click, detail: Infinity }],
    ["a key numbered NaN", { ...key, seq: NaN }],
    ["a click with no place", { ...click, x: undefined }],
    ["a click of another button", { ...click, button: "left" }],
    ["a click with no list of modifiers", { ...click, modifiers: null }],
    [
      "a click with a modifier no keyboard has",
      { ...click, modifiers: ["Hyper"] },
    ],
    ["a click of no document", { ...click, document: 1 }],
    [
      "a click that says not whether it reached the page untouched",
      { ...click, untouched: undefined },
    ],
    ["a key that says not whether it is typing", { ...key, typing: "yes" }],
    ["a key with no name", { ...key, key: null }],
  ])("is not taken when the page hands over %s", (_, value) => {
    expect(heldByPageIn(value)).toBeUndefined();
  });
});

describe("what is kept of a value a page hands over", () => {
  it("is what the schema names: a field the page adds is left behind", () => {
    expect(heldByPageIn({ ...click, extra: { big: "x".repeat(10) } })).toEqual(
      click
    );
  });
});

describe("what a page tells of an input's target", () => {
  const note = {
    type: "click",
    chain: ["e3", null, "e1"],
    under: "e3",
    held: { document: "doc_1", seq: 1 },
  };

  it("is taken as the target watch sends it: of a held click, or of an event no click held", () => {
    expect(inputNoteIn(note)).toEqual(note);
    expect(inputNoteIn({ ...note, under: null, held: null })).toEqual({
      ...note,
      under: null,
      held: null,
    });
  });

  it.each([
    ["nothing", null],
    ["an empty object", {}],
    ["a string", "x"],
    ["a list", [1, 2]],
    ["a note with no chain", { ...note, chain: null }],
    ["a chain with a number in it", { ...note, chain: ["e3", 4] }],
    ["a note with no type", { ...note, type: undefined }],
    ["a note with no element under the pointer", { ...note, under: undefined }],
    ["a held click with no number", { ...note, held: { document: "doc_1" } }],
    [
      "a held click numbered NaN",
      { ...note, held: { document: "doc_1", seq: NaN } },
    ],
    ["a held click that is a string", { ...note, held: "doc_1" }],
  ])("is not taken when the page hands over %s", (_, value) => {
    expect(inputNoteIn(value)).toBeUndefined();
  });
});
