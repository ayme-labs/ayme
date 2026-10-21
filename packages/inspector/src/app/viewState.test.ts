import { expect, it } from "vitest";

import {
  decodeViewState,
  defaultViewState,
  type ViewState,
  viewStateKey,
  withSelection,
} from "./viewState";

// Unit tests: which parts of a stored view state the Inspector comes back
// to after a reload.

it("comes back to the lens, selection and Runs region it was left with", () => {
  const left: ViewState = {
    lens: "tools",
    selection: { kind: "tool", name: "ListPage_addItem" },
    runs: { open: false, all: true },
    objectTree: {
      open: { "InboxPage.taskDialog": true, InboxPage: false },
      revealed: "InboxPage.taskDialog.taskForm",
    },
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
    objectTree: { open: {} },
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
      objectTree: {
        open: { InboxPage: "yes", "InboxPage.list": false },
        revealed: 3,
      },
    })
  ).toEqual({
    ...defaultViewState,
    runs: { open: true, all: true },
    objectTree: { open: { "InboxPage.list": false } },
  });
});

it("forgets which selection the Model tree opened up when the selection changes, keeping what is open", () => {
  const current: ViewState = {
    ...defaultViewState,
    selection: { kind: "object", path: "InboxPage.taskDialog.taskForm" },
    objectTree: {
      open: { "InboxPage.taskDialog": false },
      revealed: "InboxPage.taskDialog.taskForm",
    },
  };

  expect(withSelection(current, { kind: "node", ref: "e3" })).toEqual({
    ...current,
    selection: { kind: "node", ref: "e3" },
    objectTree: { open: { "InboxPage.taskDialog": false } },
  });
});
