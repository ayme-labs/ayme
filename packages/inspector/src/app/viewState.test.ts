import { expect, it } from "vitest";

import {
  decodeViewState,
  defaultViewState,
  type ViewState,
  viewStateKey,
} from "./viewState";

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

it("keeps its view state under its own key in the page's storage", () => {
  expect(viewStateKey).toBe("ayme-inspector:view");
});

it("opens on the Model lens at the page, with Runs open on the selection's runs", () => {
  expect(decodeViewState(undefined)).toEqual({
    lens: "model",
    selection: { kind: "page" },
    runs: { open: true, all: false },
  });
});

it.each(["model", "structure", "tools"] as const)(
  "comes back to the %s lens",
  (lens) => {
    expect(decodeViewState({ lens }).lens).toBe(lens);
  }
);

it("opens on the Model lens for an empty lens", () => {
  expect(decodeViewState({ lens: "" }).lens).toBe("model");
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
