import { expect, it } from "vitest";

import { indexMembers } from "../page-model";
import { collection, page } from "../page-model/test-utils/pageModel";
import type { StructureNode } from "../structure";
import { itemsOf } from "./collectionItems";

// Unit tests: a collection action's items as the run card offers them. The
// page model, the structure and the registry's verdicts are hand-written: a
// list page with two items, the second one covered.

const members = indexMembers({
  objects: [
    page("ListPage", {
      children: [
        collection("items", "ListItem", [{}, {}], ["ListPage.items.archive"]),
      ],
    }),
  ],
  models: [],
});

const item = (ref: string, path: string, name: string): StructureNode => ({
  ref,
  role: "listitem",
  name,
  members: [path],
  children: [],
});

const structure = {
  roots: [
    item("e1", "ListPage.items[0]", "Milk"),
    item("e2", "ListPage.items[1]", "Bread"),
  ],
  refCount: 2,
};

const milk = document.createElement("li");
const bread = document.createElement("li");
const elementsByRef = new Map([
  ["e1", milk],
  ["e2", bread],
]);

it("carries each item's verdict and reason from the registry", () => {
  const verdicts = [
    {
      label: "ListPage.items[0]",
      element: milk,
      present: true,
      available: true,
    },
    {
      label: "ListPage.items[1]",
      element: bread,
      present: true,
      available: false,
      reason: "a click would not reach it; e9 is in the way",
    },
  ];

  expect(
    itemsOf(
      "ListPage.items.archive",
      members,
      structure,
      verdicts,
      elementsByRef
    )
  ).toEqual([
    {
      path: "ListPage.items[0]",
      name: "[0]",
      pathBelowPage: "items[0]",
      ref: "e1",
      label: "Milk",
      available: true,
    },
    {
      path: "ListPage.items[1]",
      name: "[1]",
      pathBelowPage: "items[1]",
      ref: "e2",
      label: "Bread",
      available: false,
      reason: "a click would not reach it; e9 is in the way",
    },
  ]);
});

it("keeps each item's own verdict when the registry saw the items swap first", () => {
  // The registry already lists Bread first; the structure still shows Milk
  // first, under the refs it gave before the swap.
  const verdicts = [
    {
      label: "ListPage.items[0]",
      element: bread,
      present: true,
      available: false,
      reason: "Bread is locked",
    },
    {
      label: "ListPage.items[1]",
      element: milk,
      present: true,
      available: true,
    },
  ];

  expect(
    itemsOf(
      "ListPage.items.archive",
      members,
      structure,
      verdicts,
      elementsByRef
    ).map(({ label, available, reason }) => ({ label, available, reason }))
  ).toEqual([
    { label: "Milk", available: true, reason: undefined },
    { label: "Bread", available: false, reason: "Bread is locked" },
  ]);
});

it("leaves the verdict out for an item the registry has not observed", () => {
  expect(
    itemsOf("ListPage.items.archive", members, structure).map(
      (candidate) => "available" in candidate
    )
  ).toEqual([false, false]);
});
