import { describe, expect, it } from "vitest";

import { component, page } from "../test-utils/pageModel";
import { objectRows, type ObjectTree, revealSelection } from "./objectTree";

// Unit tests: which objects the Model tree shows open, and the objects it
// opens around a selection. The fixture is hand-written.

const withDialog = (live: boolean) => [
  page("InboxPage", {
    children: [
      component("taskDialog", "TaskDialog", {
        live,
        children: [component("taskForm", "TaskForm", { live })],
      }),
      component("list", "TaskList"),
    ],
  }),
];

const shape = (open: ObjectTree["open"], live = false) =>
  [...objectRows(withDialog(live), open)].map(
    ({ node, depth, open }) =>
      `${depth} ${node.path}${open === undefined ? "" : open ? " ▾" : " ▸"}`
  );

const form = "InboxPage.taskDialog.taskForm";

describe("objectRows", () => {
  it("opens the objects on the page and closes the rest", () => {
    expect(shape({})).toEqual([
      "1 InboxPage ▾",
      "2 InboxPage.taskDialog ▸",
      "2 InboxPage.list",
    ]);
  });

  it("keeps an object opened or closed by hand, on the page or not", () => {
    expect(shape({ "InboxPage.taskDialog": true })).toContain(`3 ${form}`);
    expect(shape({ InboxPage: false }, true)).toEqual(["1 InboxPage ▸"]);
  });
});

describe("revealSelection", () => {
  it("opens the closed objects around the selection, and remembers it did", () => {
    expect(revealSelection(withDialog(false), { open: {} }, form)).toEqual({
      open: { "InboxPage.taskDialog": true },
      revealed: form,
    });
  });

  it("opens nothing more once the selection was revealed, so a later close stays closed", () => {
    const closedByHand = {
      open: { "InboxPage.taskDialog": false },
      revealed: form,
    };

    expect(revealSelection(withDialog(false), closedByHand, form)).toBe(
      closedByHand
    );
  });

  it("waits for a selection whose object is not in the tree yet", () => {
    const objectTree = { open: {} };

    expect(revealSelection([], objectTree, form)).toBe(objectTree);
  });

  it("forgets the revealed selection when nothing is selected", () => {
    expect(
      revealSelection(
        withDialog(false),
        { open: {}, revealed: form },
        undefined
      )
    ).toEqual({ open: {}, revealed: undefined });
  });
});
