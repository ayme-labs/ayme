import { expect, it } from "vitest";

import { buildStructureTree } from "../adapter/structure";
import { collectionItems } from "./collectionItems";

// Unit tests: the items a collection action can run on, from the structure
// tree model. The page state and its member map are hand-written.

const { roots } = buildStructureTree(
  `- e1 main:
  - e2 list "Items":
    - e3 listitem:
      - e4 button "Milk"
      - e5 button "Archive"
    - e6 listitem: Eggs
  - e7 button "Add item"`,
  new Map([
    ["e3", "ListPage.items[0]"],
    ["e4", "ListPage.items[0].nameButton"],
    ["e6", "ListPage.items[1]"],
    ["e7", "ListPage.addItemButton"],
  ])
);

it("lists the items at the collection's path, labelled by what they show", () => {
  expect(collectionItems("ListPage.items[]", roots)).toEqual([
    { path: "ListPage.items[0]", ref: "e3", label: "Milk" },
    { path: "ListPage.items[1]", ref: "e6", label: "Eggs" },
  ]);
});

it("lists nothing for a collection that isn't on the page", () => {
  expect(collectionItems("ListPage.archived[]", roots)).toEqual([]);
});
