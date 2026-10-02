import { expect, it } from "vitest";

import { pickPromptOf, refFilterOf } from "./refPicking";

// Unit tests: which nodes a tool can use, and what picking asks for. The
// targets are hand-written, as the runtime would list them for a page.

const targets = new Map([
  ["click", ["e2", "e3"]],
  ["fill", ["e2"]],
]);
const node = (ref: string, role: string) => ({
  ref,
  role,
  name: "",
  members: [],
  children: [],
});

it("lets a Ref Tool use exactly the refs it can take", () => {
  const fill = refFilterOf(targets, "fill")!;

  expect(fill(node("e2", "textbox"))).toBe(true);
  expect(fill(node("e3", "button"))).toBe(false);
});

it("lets a tool the runtime lists no targets for use every node", () => {
  expect(refFilterOf(targets, "ListPage.addItem")).toBeUndefined();
});

it("asks for what each built-in Ref tool acts on", () => {
  expect(pickPromptOf("click")).toBe("Click an element to click");
  expect(pickPromptOf("fill")).toBe("Click a text field to fill");
});

it("names any other tool", () => {
  expect(pickPromptOf("open_row_menu")).toBe(
    "Click an element for open_row_menu"
  );
});
