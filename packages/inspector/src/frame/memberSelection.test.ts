import { describe, expect, it } from "vitest";

import { buildStructureTree } from "../adapter/structure";
import { selectionHighlight } from "./highlight";
import { memberResolves, runIsOnMember } from "./memberSelection";

// Unit tests: what a member selection highlights, when it is stale, and
// which runs are in its scope. Fixtures are hand-written.

const structure = buildStructureTree(
  `- e1 textbox "New item"
- e2 list "Items":
  - e3 listitem: Milk
  - e4 listitem: Eggs`,
  new Map([
    ["e1", ["ListPage.newItemInput"]],
    ["e3", ["ListPage.items[0]", "ListPage.items", "ListItem"]],
    ["e4", ["ListPage.items[1]", "ListPage.items", "ListItem"]],
  ])
);

describe("a member selection", () => {
  it("highlights the member's path: a locator's element, a collection's items", () => {
    expect(
      selectionHighlight({ kind: "member", path: "ListPage.newItemInput" })
    ).toEqual({ path: "ListPage.newItemInput" });
    expect(
      selectionHighlight({ kind: "member", path: "ListPage.items" })
    ).toEqual({ path: "ListPage.items" });
  });

  it("resolves while the member is on the page", () => {
    expect(memberResolves(structure, "ListPage.newItemInput")).toBe(true);
    expect(memberResolves(structure, "ListPage.items")).toBe(true);
  });

  it("is stale once the member is gone", () => {
    expect(memberResolves(structure, "ListPage.archiveDialog")).toBe(false);
    expect(memberResolves(structure, "ListPage.item")).toBe(false);
  });
});

describe("the runs of a member selection", () => {
  it("covers runs on the member and on a collection member's items", () => {
    expect(
      runIsOnMember("ListPage.items", { objectPath: "ListPage.items[1]" })
    ).toBe(true);
    expect(
      runIsOnMember("ListPage.items", { objectPath: "ListPage.itemsArchive" })
    ).toBe(false);
  });

  it("covers runs whose steps targeted the member", () => {
    expect(
      runIsOnMember("ListPage.newItemInput", {
        objectPath: "ListPage",
        stepMembers: ["ListPage.newItemInput", "ListPage.addItemButton"],
      })
    ).toBe(true);
  });

  it("leaves out runs elsewhere", () => {
    expect(
      runIsOnMember("ListPage.newItemInput", {
        objectPath: "ListPage",
        stepMembers: [undefined, "ListPage.addItemButton"],
      })
    ).toBe(false);
  });
});
