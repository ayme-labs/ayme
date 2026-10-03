import { describe, expect, it } from "vitest";

import { checkKey, keyOfEvent, modifiersOnly, suggestKeys } from "./keys";

const press = (
  key: string,
  code: string,
  held: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {}
) =>
  keyOfEvent({
    key,
    code,
    ctrlKey: held.ctrl ?? false,
    metaKey: held.meta ?? false,
    altKey: held.alt ?? false,
    shiftKey: held.shift ?? false,
  });

describe("recording a key press", () => {
  it("names keys as Playwright does", () => {
    expect(press("F5", "F5")).toBe("F5");
    expect(press("Tab", "Tab")).toBe("Tab");
    expect(press("ArrowLeft", "ArrowLeft")).toBe("ArrowLeft");
    expect(press(" ", "Space")).toBe("Space");
  });

  it("records Ctrl and ⌘ alike, with the letter of the key", () => {
    expect(press("c", "KeyC", { ctrl: true })).toBe("ControlOrMeta+C");
    expect(press("c", "KeyC", { meta: true })).toBe("ControlOrMeta+C");
    expect(press("K", "KeyK", { meta: true, shift: true })).toBe(
      "ControlOrMeta+Shift+K"
    );
  });

  it("takes the key, not the character ⌥ composes", () => {
    expect(press("ç", "KeyC", { alt: true })).toBe("Alt+C");
    expect(press("¡", "Digit1", { alt: true })).toBe("Alt+1");
  });

  it("folds Shift into a character typed on its own", () => {
    expect(press("A", "KeyA", { shift: true })).toBe("A");
    expect(press("!", "Digit1", { shift: true })).toBe("!");
    expect(press("Tab", "Tab", { shift: true })).toBe("Shift+Tab");
  });

  it("records modifiers pressed on their own in Playwright's order", () => {
    expect(modifiersOnly(["Shift"])).toBe("Shift");
    expect(modifiersOnly(["Shift", "ControlOrMeta"])).toBe(
      "ControlOrMeta+Shift"
    );
  });
});

describe("checking a typed key", () => {
  it("takes Playwright's names as they are", () => {
    for (const key of ["Enter", "F5", "a", "!", "+", "Shift+Tab", "Shift++"])
      expect(checkKey(key)).toEqual({ ok: true, value: key });
    expect(checkKey("ControlOrMeta+C")).toEqual({
      ok: true,
      value: "ControlOrMeta+C",
    });
  });

  it("gives loose spellings as Playwright names them", () => {
    expect(checkKey("ctrl+c")).toEqual({ ok: true, value: "ControlOrMeta+C" });
    expect(checkKey("esc")).toEqual({ ok: true, value: "Escape" });
    expect(checkKey("shift+tab")).toEqual({ ok: true, value: "Shift+Tab" });
    expect(checkKey("pgdn")).toEqual({ ok: true, value: "PageDown" });
  });

  it("offers the closest name for a typo", () => {
    expect(checkKey("shift+tabb")).toEqual({
      ok: false,
      problem: "“tabb” isn't a key name.",
      fix: "Shift+Tab",
    });
    expect(checkKey("qwertyuiop")).toEqual({
      ok: false,
      problem: "“qwertyuiop” isn't a key name.",
    });
  });

  it("takes only modifiers before +", () => {
    expect(checkKey("Tab+a")).toEqual({
      ok: false,
      problem: "Only modifiers can come before +, and Tab isn't one.",
    });
    expect(checkKey("Shift+")).toEqual({
      ok: false,
      problem: "Add a key after the +.",
    });
  });

  it("takes no key as empty", () => {
    expect(checkKey("  ")).toEqual({ ok: true, value: "" });
  });
});

describe("suggesting keys", () => {
  const labels = (text: string) => suggestKeys(text).map(({ label }) => label);

  it("lists the names that match", () => {
    expect(labels("arr")).toEqual([
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
    ]);
  });

  it("puts the key an alias means first", () => {
    expect(labels("esc")[0]).toBe("Escape");
    expect(labels("ctrl")[0]).toBe("ControlOrMeta");
  });

  it("continues a combo after a modifier", () => {
    expect(suggestKeys("ctrl")[0]?.value).toBe("ControlOrMeta+");
    expect(labels("ctrl+ent")[0]).toBe("ControlOrMeta+Enter");
    expect(labels("ctrl+c")[0]).toBe("ControlOrMeta+C");
  });
});
