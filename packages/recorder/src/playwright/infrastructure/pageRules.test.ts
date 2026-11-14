import { describe, expect, it } from "vitest";

import {
  ancestorChain,
  clickHeld,
  gateStartsOn,
  keyHeld,
  keyRoute,
  letThroughUpTo,
  mouseRoute,
  keyTarget,
  leftAlone,
  modifiersOf,
  recordedAsPress,
  replayed,
  replayedEffect,
  withRules,
  type KeyFacts,
} from "./pageRules";

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
    [
      "an L on the page is a press",
      { key: "l", code: "KeyL", target: "other" },
      true,
    ],
    [
      "an arrow key with Shift is a press",
      { key: "ArrowDown", code: "ArrowDown", shift: true },
      true,
    ],
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
  const button = { nodeName: "BUTTON", inputType: "" };

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
        target: { nodeName: "SELECT", inputType: "" },
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
      { nodeName: "AYME-RECORDER-TOOLBAR", inputType: "" },
      true,
    ],
    ["a native list", { nodeName: "SELECT", inputType: "" }, true],
    ["one of its options", { nodeName: "OPTION", inputType: "" }, true],
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
    ["a button", { nodeName: "BUTTON", inputType: "" }, false],
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

  it("is sent with each of several rules, and with none it does not need", () => {
    const add = (value: number) => value + 1;
    const both = (
      value: number,
      rules: {
        quadruple: (value: number) => number;
        add: (value: number) => number;
      }
    ) => rules.add(rules.quadruple(value));
    const sent = withRules(both, { quadruple, add }, [double]);
    const alone = withRules(
      (value: number, rules: { add: typeof add }) => rules.add(value),
      { add }
    );
    const run = (fn: (value: number) => number) =>
      (new Function(`return (${String(fn)})(2);`) as () => number)();

    expect(run(sent)).toBe(9);
    expect(run(alone)).toBe(3);
  });
});

describe("how the gate of a new document starts", () => {
  it("as the latest start said, and off when none did", () => {
    expect(gateStartsOn({ on: true })).toBe(true);
    expect(gateStartsOn({ on: false })).toBe(false);
    expect(gateStartsOn(undefined)).toBe(false);
  });
});

describe("what the gate does with a mouse event", () => {
  const trusted = { trusted: true, type: "click", button: 0 };
  const gate = { picking: false, replayed: false, on: true, holding: true };

  it("leaves an event no person gave alone", () => {
    expect(mouseRoute({ ...trusted, trusted: false }, gate)).toBe("ignore");
  });

  it("while Playwright picks, leaves events to it, and ends the pick on the left button's click", () => {
    const picking = { ...gate, picking: true };
    expect(mouseRoute(trusted, picking)).toBe("endPicking");
    expect(mouseRoute({ ...trusted, button: 2 }, picking)).toBe("ignore");
    expect(mouseRoute({ ...trusted, type: "mousedown" }, picking)).toBe(
      "ignore"
    );
  });

  it("lets an event of the click it sends on through", () => {
    expect(mouseRoute(trusted, { ...gate, replayed: true })).toBe("passOn");
  });

  it("only notes the button when it is off and holds nothing", () => {
    expect(mouseRoute(trusted, { ...gate, on: false, holding: false })).toBe(
      "noteOnly"
    );
  });

  it("handles a click and a double click while it is on or still holds", () => {
    expect(mouseRoute(trusted, { ...gate, on: false })).toBe("click");
    expect(mouseRoute({ ...trusted, type: "dblclick" }, gate)).toBe(
      "doubleClick"
    );
    expect(mouseRoute({ ...trusted, type: "pointerdown" }, gate)).toBe(
      "noteOnly"
    );
  });
});

describe("what the gate does with a key event", () => {
  const down = {
    trusted: true,
    type: "keydown",
    key: "a",
    code: "KeyA",
    composing: false,
  };
  const gate = { picking: false, passingKey: undefined };

  it("leaves a key no person gave, or one given while Playwright picks, alone", () => {
    expect(keyRoute({ ...down, trusted: false }, gate)).toBe("ignore");
    expect(keyRoute(down, { ...gate, picking: true })).toBe("ignore");
  });

  it("takes a release as a release", () => {
    expect(keyRoute({ ...down, type: "keyup" }, gate)).toBe("keyUp");
  });

  it("knows the key it sends on by its code", () => {
    expect(keyRoute(down, { ...gate, passingKey: "KeyA" })).toBe("arrived");
    expect(keyRoute(down, { ...gate, passingKey: "KeyB" })).toBe("consider");
  });

  it("leaves a modifier on its own, and a key that composes text, alone", () => {
    for (const key of ["Shift", "Control", "Meta", "Alt", "Process"])
      expect(keyRoute({ ...down, key }, gate)).toBe("ignore");
    expect(keyRoute({ ...down, composing: true }, gate)).toBe("ignore");
  });

  it("considers holding any other key", () => {
    expect(keyRoute(down, gate)).toBe("consider");
  });
});

describe("which key the gate holds, and whether it is typing", () => {
  it("holds a key recorded as a press while it is on", () => {
    expect(keyHeld({ on: true, press: true, holding: false })).toEqual({
      held: true,
      typing: false,
    });
  });

  it("holds every key, as typing, once it holds anything", () => {
    expect(keyHeld({ on: false, press: true, holding: true })).toEqual({
      held: true,
      typing: true,
    });
    expect(keyHeld({ on: true, press: false, holding: true })).toEqual({
      held: true,
      typing: true,
    });
  });

  it("lets typing through, and any key while it is off and holds nothing", () => {
    expect(keyHeld({ on: true, press: false, holding: false }).held).toBe(
      false
    );
    expect(keyHeld({ on: false, press: true, holding: false }).held).toBe(
      false
    );
  });
});

describe("the refs of a node and those above it", () => {
  type Node = { ref: string | null; up: Node | null };
  const top: Node = { ref: "e1", up: null };
  const middle: Node = { ref: null, up: top };
  const bottom: Node = { ref: "e3", up: middle };
  const chainFrom = (node: Node | null) =>
    ancestorChain(
      node,
      (at) => at.up,
      (at) => at.ref
    );

  it("are listed nearest first, with null where a node has none", () => {
    expect(chainFrom(bottom)).toEqual(["e3", null, "e1"]);
  });

  it("are none from no node", () => {
    expect(chainFrom(null)).toEqual([]);
  });
});

describe("up to which held input a document lets what follows through", () => {
  // Held in order: a1 and a2 in document a, b1 in document b.
  const known = [
    { id: "input_1", seq: 1, document: "a" },
    { id: "input_2", seq: 1, document: "b" },
    { id: "input_3", seq: 2, document: "a" },
  ];
  const inA = (input: { document: string }) => input.document === "a";

  it("is the last that document held up to and with the one named", () => {
    expect(letThroughUpTo(known, "input_3", inA)).toBe(2);
    expect(letThroughUpTo(known, "input_2", inA)).toBe(1);
    expect(
      letThroughUpTo(known, "input_2", (input) => input.document === "b")
    ).toBe(1);
  });

  it("is 0 when the document held none of them, or none is named or known", () => {
    expect(
      letThroughUpTo(known, "input_1", (input) => input.document === "b")
    ).toBe(0);
    expect(letThroughUpTo(known, null, inA)).toBe(0);
    expect(letThroughUpTo(known, "input_9", inA)).toBe(0);
  });
});
