import { expect, it } from "vitest";

import { toolChangeNote } from "./toolChangeNote";

const state = (names: string[], hidden: string[] = []) => ({
  names,
  hidden,
});

it("names the tools that appeared and disappeared", () => {
  expect(
    toolChangeNote(
      state(["snapshot", "Cart.checkout"]),
      state(["snapshot", "Basket.add"])
    )
  ).toBe(
    "The connected tools changed since your previous call. Appeared: Basket.add. Disappeared: Cart.checkout. ayme_list_tools lists the current tools; ayme_call runs any of them."
  );
});

it("leaves out the side that did not change", () => {
  const note = toolChangeNote(state([]), state(["snapshot", "click"]));
  expect(note).toContain("Appeared: snapshot, click.");
  expect(note).not.toContain("Disappeared");
  expect(toolChangeNote(state(["snapshot"]), state([]))).not.toContain(
    "Appeared"
  );
});

it("gives no note when the same tools are there, in any order", () => {
  expect(toolChangeNote(state([]), state([]))).toBeUndefined();
  expect(toolChangeNote(state(["a", "b"]), state(["b", "a"]))).toBeUndefined();
});

it("says which App Process tool is newly hidden, and why", () => {
  expect(
    toolChangeNote(
      state(["peek.node.jobs"]),
      state(["peek.node.jobs"], ["peek.node.jobs"])
    )
  ).toBe(
    "The connected tools changed since your previous call. Hidden: peek.node.jobs, because another App Process offers a tool with the same name; you reach the first App Process's. ayme_list_tools lists the current tools; ayme_call runs any of them."
  );
  expect(
    toolChangeNote(
      state(["peek.node.jobs"], ["peek.node.jobs"]),
      state(["peek.node.jobs"], ["peek.node.jobs"])
    )
  ).toBeUndefined();
});
