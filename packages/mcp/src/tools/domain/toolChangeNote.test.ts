import { expect, it } from "vitest";

import { toolChangeNote, type SeenTool } from "./toolChangeNote";

const available = (name: string): SeenTool => ({ name, available: true });
const unavailable = (name: string, reason?: string): SeenTool => ({
  name,
  available: false,
  ...(reason === undefined ? {} : { reason }),
});
const state = (tools: (string | SeenTool)[], hidden: string[] = []) => ({
  tools: tools.map((tool) =>
    typeof tool === "string" ? available(tool) : tool
  ),
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

it("names the tools that became available or unavailable, with the reason when there is one", () => {
  expect(
    toolChangeNote(
      state([
        "snapshot",
        unavailable("Panel.remove", "No item is selected"),
        unavailable("Panel.duplicate"),
        "Dialog.close",
      ]),
      state([
        "snapshot",
        "Panel.remove",
        "Panel.duplicate",
        unavailable(
          "Dialog.close",
          "a click would not reach it; e7 is in the way"
        ),
      ])
    )
  ).toBe(
    "The connected tools changed since your previous call. Became available: Panel.remove, Panel.duplicate. Became unavailable: Dialog.close (a click would not reach it; e7 is in the way). ayme_list_tools lists the current tools; ayme_call runs any of them."
  );
  expect(
    toolChangeNote(
      state(["Panel.remove"]),
      state([unavailable("Panel.remove")])
    )
  ).toContain("Became unavailable: Panel.remove.");
});

it("gives no note when only a reason changed, and marks an appeared tool that is unavailable", () => {
  expect(
    toolChangeNote(
      state([unavailable("Panel.remove", "Nothing to remove")]),
      state([unavailable("Panel.remove", "No item is selected")])
    )
  ).toBeUndefined();
  expect(
    toolChangeNote(
      state([]),
      state([
        unavailable("Panel.remove", "No item is selected"),
        unavailable("Panel.copy"),
      ])
    )
  ).toContain(
    "Appeared: Panel.remove (unavailable: No item is selected), Panel.copy (unavailable)."
  );
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
