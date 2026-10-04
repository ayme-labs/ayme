import { expect, it } from "vitest";

import { indexMembers } from "../adapter/memberIndex";
import { page } from "../adapter/pageModel.testSupport";
import { buildStructureTree, emptyStructure } from "../adapter/structure";
import { isStaleSelection } from "./staleSelection";

// Unit tests: which selections the frame sends back to the page. Fixtures
// are hand-written.

const index = indexMembers({
  objects: [page("ListPage", { locators: ["newItemInput"] })],
  models: [],
});
const structure = buildStructureTree(
  `- e1 textbox "New item"`,
  new Map([["e1", ["ListPage.newItemInput"]]]),
  index
);
const within = (path: string) => index.within(path);
const read = { structure, pageStateRead: true, within };

it("keeps a member that is on the page, even when no lens shows it", () => {
  expect(
    isStaleSelection(
      { kind: "member", path: "ListPage.newItemInput" },
      { ...read, hasView: false }
    )
  ).toBe(false);
});

it("drops a member once it is gone from the page", () => {
  expect(
    isStaleSelection(
      { kind: "member", path: "ListPage.archiveDialog" },
      { ...read, hasView: true }
    )
  ).toBe(true);
});

it("keeps a member until the page state has been read", () => {
  expect(
    isStaleSelection(
      { kind: "member", path: "ListPage.newItemInput" },
      {
        structure: emptyStructure,
        pageStateRead: false,
        hasView: false,
        within,
      }
    )
  ).toBe(false);
});

it("drops any other selection that no lens can show", () => {
  const tool = { kind: "tool", name: "ListPage.addItem" } as const;

  expect(isStaleSelection(tool, { ...read, hasView: false })).toBe(true);
  expect(isStaleSelection(tool, { ...read, hasView: true })).toBe(false);
});

it("never drops the page", () => {
  expect(isStaleSelection({ kind: "page" }, { ...read, hasView: false })).toBe(
    false
  );
});
