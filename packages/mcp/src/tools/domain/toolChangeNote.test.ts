import { expect, it } from "vitest";

import { toolChangeNote } from "./toolChangeNote";

it("names the tools that appeared and disappeared", () => {
  expect(
    toolChangeNote(["snapshot", "Cart.checkout"], ["snapshot", "Basket.add"])
  ).toBe(
    "The page's tools changed since your previous call. Appeared: Basket.add. Disappeared: Cart.checkout. ayme_list_tools lists the current tools; ayme_call runs any of them."
  );
});

it("leaves out the side that did not change", () => {
  const note = toolChangeNote([], ["snapshot", "click"]);
  expect(note).toContain("Appeared: snapshot, click.");
  expect(note).not.toContain("Disappeared");
  expect(toolChangeNote(["snapshot"], [])).not.toContain("Appeared");
});

it("gives no note when the same tools are there, in any order", () => {
  expect(toolChangeNote([], [])).toBeUndefined();
  expect(toolChangeNote(["a", "b"], ["b", "a"])).toBeUndefined();
});
