import { describe, expect, it } from "vitest";

import { indexMembers } from "../../page-model/domain/memberIndex";
import { collection, model, page } from "../../page-model/test-utils/pageModel";
import { forest, node } from "../test-utils/projected";
import { buildStructureTree } from "../infrastructure/structureTree";
import { selectionHighlight } from "../../navigation/domain/highlight";
import {
  memberResolves as resolvesIn,
  runIsOnMember as runIsOn,
} from "./memberSelection";

// Unit tests: what a member selection highlights, when it is stale, and
// which runs are in its scope. Fixtures are hand-written.

const index = indexMembers({
  objects: [
    page("ListPage", {
      locators: ["newItemInput", "addItemButton"],
      children: [
        collection("items", "ListItem", [
          { locators: ["nameButton"] },
          { locators: ["nameButton"] },
        ]),
      ],
    }),
  ],
  models: [model("ListItem", ["nameButton"])],
});
const structure = buildStructureTree(
  forest(
    node({ ref: "e1", role: "textbox", name: "New item" }),
    node(
      { ref: "e2", role: "list", name: "Items" },
      node({ ref: "e3", role: "listitem" }, "Milk"),
      node({ ref: "e4", role: "listitem" }, "Eggs")
    )
  ),
  new Map([
    ["e1", ["ListPage.newItemInput"]],
    ["e3", ["ListPage.items[0].root"]],
    ["e4", ["ListPage.items[1].root"]],
  ]),
  index
);
const memberResolves = (path: string) =>
  resolvesIn(structure, index.within(path));
const runIsOnMember = (path: string, run: Parameters<typeof runIsOn>[1]) =>
  runIsOn(index.within(path, { models: false }), run);

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
    expect(memberResolves("ListPage.newItemInput")).toBe(true);
    expect(memberResolves("ListPage.items")).toBe(true);
  });

  it("resolves a model's member while it is on one of the instances", () => {
    expect(
      resolvesIn(
        buildStructureTree(
          forest(node({ ref: "e1", role: "button", name: "Milk" })),
          new Map([["e1", ["ListPage.items[1].nameButton"]]]),
          index
        ),
        index.within("ListItem.nameButton")
      )
    ).toBe(true);
    expect(memberResolves("ListItem.nameButton")).toBe(false);
  });

  it("is stale once the member is gone", () => {
    expect(memberResolves("ListPage.archiveDialog")).toBe(false);
    expect(memberResolves("ListPage.item")).toBe(false);
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
