import { describe, expect, it } from "vitest";

import { isHeldByPage, isInputNote } from "./pageValues";

// A page can call the recorder's page functions itself, with anything: what
// it hands over is taken only in the shape the recorder's own in-page code
// sends.

const click = {
  kind: "click",
  seq: 1,
  x: 10,
  y: 20,
  detail: 1,
  modifiers: [],
  document: "doc_1",
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
  it("is taken as the gate sends it: a click, with or without its button, or a key", () => {
    expect(isHeldByPage(click)).toBe(true);
    expect(isHeldByPage({ ...click, button: "right" })).toBe(true);
    expect(isHeldByPage(key)).toBe(true);
  });

  it.each([
    ["nothing", null],
    ["an empty object", {}],
    ["a click with nothing but its kind", { kind: "click" }],
    ["a key with nothing but its kind", { kind: "key" }],
    ["another kind of input", { ...click, kind: "drag" }],
    ["a click with no number", { ...click, seq: "1" }],
    ["a click with no place", { ...click, x: undefined }],
    ["a click of another button", { ...click, button: "left" }],
    ["a click with no list of modifiers", { ...click, modifiers: null }],
    [
      "a click with a modifier no keyboard has",
      { ...click, modifiers: ["Hyper"] },
    ],
    ["a click of no document", { ...click, document: 1 }],
    ["a key that says not whether it is typing", { ...key, typing: "yes" }],
    ["a key with no name", { ...key, key: null }],
  ])("is not taken when the page hands over %s", (_, value) => {
    expect(isHeldByPage(value)).toBe(false);
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
    expect(isInputNote(note)).toBe(true);
    expect(isInputNote({ ...note, under: null, held: null })).toBe(true);
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
    ["a held click that is a string", { ...note, held: "doc_1" }],
  ])("is not taken when the page hands over %s", (_, value) => {
    expect(isInputNote(value)).toBe(false);
  });
});
