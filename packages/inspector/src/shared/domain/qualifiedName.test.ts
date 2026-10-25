import { expect, it } from "vitest";

import { splitQualifiedName } from "./qualifiedName";

// Unit tests: where a qualified name splits, so its start can give way
// before its last segment.

it("splits a path before its last segment", () => {
  expect(splitQualifiedName("ListPage.items[1].name")).toEqual([
    "ListPage.items[1]",
    ".name",
  ]);
  expect(splitQualifiedName("ListPage.items[1]")).toEqual([
    "ListPage",
    ".items[1]",
  ]);
});

it("leaves a name without a dot whole", () => {
  expect(splitQualifiedName("snapshot")).toBeUndefined();
});

it("leaves a name whose only dot leads it whole", () => {
  expect(splitQualifiedName(".hidden")).toBeUndefined();
});

it("leaves a label with spaces whole, dots and all", () => {
  expect(splitQualifiedName('e3 link "example.com"')).toBeUndefined();
});
