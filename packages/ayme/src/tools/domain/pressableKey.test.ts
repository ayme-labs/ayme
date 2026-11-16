import { describe, expect, it } from "vitest";

import { isPressableKey } from "./pressableKey";

describe("isPressableKey", () => {
  it.each([
    "a",
    "A",
    "1",
    " ",
    "+",
    "!",
    "Enter",
    "\n",
    "Escape",
    "ArrowLeft",
    "KeyA",
    "Numpad1",
    "F12",
    "ControlOrMeta",
    "Control+A",
    "ControlOrMeta+A",
    "Shift+ArrowLeft",
    "Control+Shift+Alt+Meta+Delete",
    "Control++",
  ])("presses %j", (key) => {
    expect(isPressableKey(key)).toBe(true);
  });

  it.each([
    "",
    "Foo",
    "F13",
    "ab",
    "€",
    "Control+",
    "+Control",
    "a+",
    "a+b",
    "AltGraph+a",
    "Shift+Foo",
    "Foo+A",
  ])("does not press %j", (key) => {
    expect(isPressableKey(key)).toBe(false);
  });
});
