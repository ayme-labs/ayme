import { describe, expect, it } from "vitest";

import {
  clickHeld,
  keyTarget,
  leftAlone,
  modifiersOf,
  recordedAsPress,
  replayed,
  replayedEffect,
  withRules,
  type KeyFacts,
} from "./pageScripts";

// The rules the gate decides by, in Node. The page runs the same functions:
// `withRules` sends them with the gate. The contract suite checks, per
// Playwright version, that the key rule is Playwright's.

const key = (facts: Partial<KeyFacts>): KeyFacts => ({
  key: "a",
  code: "KeyA",
  ctrl: false,
  alt: false,
  meta: false,
  shift: false,
  target: "input",
  mac: false,
  ...facts,
});

describe("which key Playwright records as a press, not as typing", () => {
  it.each<[string, Partial<KeyFacts>, boolean]>([
    ["a letter in a field is typing", {}, false],
    ["a letter in a text area is typing", { target: "textarea" }, false],
    ["a letter on the page is a press", { target: "other" }, true],
    ["a letter with Control is a press", { ctrl: true }, true],
    ["a letter with Alt is a press", { alt: true }, true],
    ["a letter with Meta is a press", { meta: true }, true],
    [
      "a capital letter typed with Shift is typing",
      { key: "A", shift: true },
      false,
    ],
    ["Enter in a field is a press", { key: "Enter", code: "Enter" }, true],
    [
      "Enter on the page is a press",
      { key: "Enter", code: "Enter", target: "other" },
      true,
    ],
    [
      "Enter in a text area is typing",
      { key: "Enter", code: "Enter", target: "textarea" },
      false,
    ],
    [
      "Enter in an editable element is typing",
      { key: "Enter", code: "Enter", target: "contentEditable" },
      false,
    ],
    ["Tab is a press", { key: "Tab", code: "Tab" }, true],
    ["an arrow key is a press", { key: "ArrowDown", code: "ArrowDown" }, true],
    ["Backspace is typing", { key: "Backspace", code: "Backspace" }, false],
    ["Delete is typing", { key: "Delete", code: "Delete" }, false],
    ["AltGraph is typing", { key: "AltGraph", code: "AltRight" }, false],
    [
      "@ typed as Alt+L is typing",
      { key: "@", code: "KeyL", alt: true },
      false,
    ],
    [
      "@ typed elsewhere on the page is a press",
      { key: "@", code: "Digit2", target: "other" },
      true,
    ],
    [
      "pasting with Control+V off a Mac is typing",
      { key: "v", ctrl: true },
      false,
    ],
    [
      "Control+V on a Mac is a press",
      { key: "v", ctrl: true, mac: true },
      true,
    ],
    [
      "pasting with Meta+V on a Mac is typing",
      { key: "v", meta: true, mac: true },
      false,
    ],
    ["Meta+V off a Mac is a press", { key: "v", meta: true }, true],
    [
      "pasting with Shift+Insert off a Mac is typing",
      { key: "Insert", code: "Insert", shift: true },
      false,
    ],
    [
      "Shift+Insert on a Mac is a press",
      { key: "Insert", code: "Insert", shift: true, mac: true },
      true,
    ],
    ["Insert alone is a press", { key: "Insert", code: "Insert" }, true],
  ])("%s", (_, facts, press) => {
    expect(recordedAsPress(key(facts))).toBe(press);
  });
});

describe("what kind of target a key goes to", () => {
  it.each<[string, Parameters<typeof keyTarget>[0], KeyFacts["target"]]>([
    ["nothing", null, "other"],
    ["a field", { nodeName: "INPUT", isContentEditable: false }, "input"],
    [
      "a text area",
      { nodeName: "TEXTAREA", isContentEditable: false },
      "textarea",
    ],
    [
      "an editable element",
      { nodeName: "DIV", isContentEditable: true },
      "contentEditable",
    ],
    ["a button", { nodeName: "BUTTON", isContentEditable: false }, "other"],
  ])("%s", (_, target, kind) => {
    expect(keyTarget(target)).toBe(kind);
  });
});

describe("which click the gate holds back", () => {
  const button = { nodeName: "BUTTON", inputType: null };

  it("holds the left button's click on an element", () => {
    expect(clickHeld({ button: 0, detail: 1, target: button })).toBe(true);
    expect(clickHeld({ button: 0, detail: 2, target: button })).toBe(true);
  });

  it("leaves other buttons, a click with no count, and targets Playwright leaves alone to the page", () => {
    expect(clickHeld({ button: 2, detail: 1, target: button })).toBe(false);
    expect(clickHeld({ button: 1, detail: 1, target: button })).toBe(false);
    // A key's or a label's click.
    expect(clickHeld({ button: 0, detail: 0, target: button })).toBe(false);
    expect(
      clickHeld({
        button: 0,
        detail: 1,
        target: { nodeName: "SELECT", inputType: null },
      })
    ).toBe(false);
    expect(clickHeld({ button: 0, detail: 1, target: null })).toBe(false);
  });
});

describe("which targets the gate leaves alone", () => {
  it.each<[string, Parameters<typeof leftAlone>[0], boolean]>([
    ["no element", null, true],
    [
      "the recorder's toolbar",
      { nodeName: "AYME-RECORDER-TOOLBAR", inputType: null },
      true,
    ],
    ["a native list", { nodeName: "SELECT", inputType: null }, true],
    ["one of its options", { nodeName: "OPTION", inputType: null }, true],
    ["a file input", { nodeName: "INPUT", inputType: "file" }, true],
    ["a colour picker", { nodeName: "INPUT", inputType: "color" }, true],
    ["a date picker", { nodeName: "INPUT", inputType: "date" }, true],
    [
      "a local date and time picker",
      { nodeName: "INPUT", inputType: "datetime-local" },
      true,
    ],
    ["a month picker", { nodeName: "INPUT", inputType: "month" }, true],
    ["a range", { nodeName: "INPUT", inputType: "range" }, true],
    ["a time picker", { nodeName: "INPUT", inputType: "time" }, true],
    ["a week picker", { nodeName: "INPUT", inputType: "week" }, true],
    ["a checkbox", { nodeName: "INPUT", inputType: "checkbox" }, false],
    ["a text field", { nodeName: "INPUT", inputType: "text" }, false],
    ["a button", { nodeName: "BUTTON", inputType: null }, false],
  ])("%s", (_, target, alone) => {
    expect(leftAlone(target)).toBe(alone);
  });
});

describe("the modifiers held with an input", () => {
  it("lists them in a fixed order", () => {
    expect(
      modifiersOf({
        altKey: true,
        ctrlKey: true,
        metaKey: true,
        shiftKey: true,
      })
    ).toEqual(["Alt", "Control", "Meta", "Shift"]);
    expect(
      modifiersOf({
        altKey: false,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      })
    ).toEqual(["Control"]);
    expect(
      modifiersOf({
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      })
    ).toEqual([]);
  });
});

describe("which event is the click the gate sends on", () => {
  const passing = { x: 100, y: 50, detail: 2, seen: [] as string[] };

  it("knows it by its place, within a pixel, and its count", () => {
    expect(
      replayed({ type: "click", x: 100.5, y: 49.5, detail: 2 }, passing)
    ).toBe(true);
    expect(replayed({ type: "click", x: 101, y: 50, detail: 2 }, passing)).toBe(
      false
    );
    expect(replayed({ type: "click", x: 100, y: 49, detail: 2 }, passing)).toBe(
      false
    );
    // The second press of a double click at the same place is the person's.
    expect(
      replayed({ type: "mousedown", x: 100, y: 50, detail: 1 }, passing)
    ).toBe(false);
  });

  it("takes a pointer event, which has no count, by its place", () => {
    expect(
      replayed({ type: "pointerdown", x: 100, y: 50, detail: 0 }, passing)
    ).toBe(true);
  });

  it("takes one event of each type, and none when nothing is sent on", () => {
    expect(
      replayed(
        { type: "mouseup", x: 100, y: 50, detail: 2 },
        { ...passing, seen: ["mouseup"] }
      )
    ).toBe(false);
    expect(
      replayed({ type: "click", x: 100, y: 50, detail: 2 }, undefined)
    ).toBe(false);
  });

  it("lets only its click reach the page: its press and its release did already", () => {
    expect(replayedEffect("mousedown")).toBe("swallow");
    expect(replayedEffect("click")).toBe("arrive");
    expect(replayedEffect("mouseup")).toBe("stop");
    expect(replayedEffect("pointerdown")).toBe("stop");
  });
});

describe("a page function sent with the rules it uses", () => {
  const double = (value: number) => value * 2;
  const quadruple = (value: number) => double(double(value));
  const main = (
    value: number,
    rules: { quadruple: (value: number) => number }
  ) => rules.quadruple(value);

  it("runs here with its rules", () => {
    expect(withRules(main, { quadruple }, [double])(3)).toBe(12);
  });

  it("is sent as text that holds its rules, and what they use, and needs nothing of this module", () => {
    const sent = withRules(main, { quadruple }, [double]);
    // As Playwright sends it: its text, called with the argument.
    const inPage = new Function(`return (${String(sent)})(5);`) as () => number;

    expect(inPage()).toBe(20);
  });
});
