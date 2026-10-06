import { expect, it } from "vitest";

import { decodeViewState, defaultViewState, type ViewState } from "./viewState";

// Unit tests: which parts of a stored view state the Inspector comes back
// to after a reload.

it("comes back to the lens, selection and Runs region it was left with", () => {
  const left: ViewState = {
    lens: "tools",
    selection: { kind: "tool", name: "ListPage_addItem" },
    runs: { open: false, all: true },
  };

  expect(decodeViewState(JSON.parse(JSON.stringify(left)))).toEqual(left);
});

it.each([
  { kind: "object", path: "ListPage.items[1]" },
  { kind: "member", path: "ListPage.addItemButton" },
  { kind: "model", className: "ListPage" },
  { kind: "tool", name: "click" },
])("keeps a selected $kind", (selection) => {
  expect(decodeViewState({ ...defaultViewState, selection }).selection).toEqual(
    selection
  );
});

it("goes back to the page for a structure node, whose ref may name another element after a reload", () => {
  const stored = {
    ...defaultViewState,
    selection: { kind: "node", ref: "e12" },
  };

  expect(decodeViewState(stored).selection).toEqual({ kind: "page" });
});

it("opens with the defaults when nothing is stored yet", () => {
  expect(decodeViewState(undefined)).toEqual(defaultViewState);
});

it("falls back to the default for each malformed value", () => {
  expect(
    decodeViewState({
      lens: "elsewhere",
      selection: { kind: "member" },
      runs: { open: "yes", all: true },
    })
  ).toEqual({ ...defaultViewState, runs: { open: true, all: true } });
});
