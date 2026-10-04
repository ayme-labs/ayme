import { describe, expect, it } from "vitest";

import { indexMembers, pathBelowPage } from "./memberIndex";
import { collection, component, model, page } from "./pageModel.testSupport";

// Unit tests: the page model indexed by member path, for what a path stands
// for on the page. The page model is hand-written: a list page with two
// items, each with its tags, a header, and a Header page of its own.

const index = indexMembers({
  objects: [
    page("ListPage", {
      locators: ["newItemInput"],
      children: [
        component("header", "Header", { locators: ["title"] }),
        collection(
          "items",
          "ListItem",
          [
            {
              locators: ["nameButton"],
              children: [
                collection(
                  "tags",
                  "Tag",
                  [{}, {}],
                  ["ListPage.items.tags.remove"]
                ),
              ],
            },
            {
              locators: ["nameButton"],
              children: [
                collection("tags", "Tag", [{}], ["ListPage.items.tags.remove"]),
              ],
            },
          ],
          ["ListPage.items.archive"]
        ),
      ],
    }),
    page("Header", { locators: ["title"] }),
  ],
  models: [
    model("ListPage", ["newItemInput", "header", "items"]),
    model("ListItem", ["nameButton", "tags"]),
    model("Header", ["title"]),
    model("Tag", []),
  ],
});

describe("the member a registry target is", () => {
  it("is the Page Object for its root, owned by itself", () => {
    expect(index.member("ListPage.items[1].root")).toMatchObject({
      path: "ListPage.items[1]",
      owner: { path: "ListPage.items[1]", kind: "item" },
    });
    expect(index.member("ListPage.root")).toMatchObject({
      path: "ListPage",
      owner: { path: "ListPage", kind: "page" },
    });
  });

  it("is the locator, owned by the Page Object declaring it", () => {
    expect(index.member("ListPage.items[1].nameButton")).toMatchObject({
      path: "ListPage.items[1].nameButton",
      owner: { path: "ListPage.items[1]" },
      locator: { name: "nameButton" },
    });
  });

  it("is unknown for a target the page model doesn't have", () => {
    expect(index.member("ListPage.items[2].root")).toBeUndefined();
    expect(index.member("ListPage.items")).toBeUndefined();
  });
});

describe("the targets a path stands for", () => {
  it("are a Page Object's root, a locator's own path", () => {
    expect(index.targets("ListPage.header")).toEqual(
      new Set(["ListPage.header.root"])
    );
    expect(index.targets("ListPage.items[0].nameButton")).toEqual(
      new Set(["ListPage.items[0].nameButton"])
    );
  });

  it("are a collection's items' roots", () => {
    expect(index.targets("ListPage.items")).toEqual(
      new Set(["ListPage.items[0].root", "ListPage.items[1].root"])
    );
  });

  it("are every instance's root for a Page Object Model, a page of it too", () => {
    expect(index.targets("Header")).toEqual(
      new Set(["ListPage.header.root", "Header.root"])
    );
  });

  it("are that member on every instance for a model's member", () => {
    expect(index.targets("ListItem.nameButton")).toEqual(
      new Set(["ListPage.items[0].nameButton", "ListPage.items[1].nameButton"])
    );
    expect(index.targets("ListItem.tags")).toEqual(
      new Set([
        "ListPage.items[0].tags[0].root",
        "ListPage.items[0].tags[1].root",
        "ListPage.items[1].tags[0].root",
      ])
    );
    expect(index.targets("Header.title")).toEqual(
      new Set(["ListPage.header.title", "Header.title"])
    );
  });

  it("are none for a path the page model doesn't have", () => {
    expect(index.targets("ListPage.archiveDialog")).toEqual(new Set());
  });
});

describe("what a path covers", () => {
  it("is a collection, its items and everything in them", () => {
    expect(index.within("ListPage.items[1]")).toEqual(
      new Set([
        "ListPage.items[1]",
        "ListPage.items[1].nameButton",
        "ListPage.items[1].tags",
        "ListPage.items[1].tags[0]",
      ])
    );
    expect(index.within("ListPage.items")).toContain(
      "ListPage.items[0].tags[1]"
    );
    expect(index.within("ListPage.items")).not.toContain("ListPage.header");
  });

  it("is a model's member on every instance, unless only objects count", () => {
    expect(index.within("ListItem.nameButton")).toEqual(
      new Set(["ListPage.items[0].nameButton", "ListPage.items[1].nameButton"])
    );
    expect(index.within("ListItem.nameButton", { models: false })).toEqual(
      new Set()
    );
    expect(index.within("Header", { models: false })).toEqual(
      new Set(["Header", "Header.title"])
    );
  });
});

it("finds a collection action's items in every collection it runs on, in page order", () => {
  expect(
    index.collectionItems("ListPage.items.tags.remove").map(({ path }) => path)
  ).toEqual([
    "ListPage.items[0].tags[0]",
    "ListPage.items[0].tags[1]",
    "ListPage.items[1].tags[0]",
  ]);
  expect(
    index.collectionItems("ListPage.items.archive").map(({ path }) => path)
  ).toEqual(["ListPage.items[0]", "ListPage.items[1]"]);
  expect(index.collectionItems("ListPage.addItem")).toEqual([]);
});

it("names an item by its path below its page", () => {
  const [first, second] = index.collectionItems("ListPage.items.tags.remove");

  expect(pathBelowPage(first!, index)).toBe("items[0].tags[0]");
  expect(pathBelowPage(second!, index)).toBe("items[0].tags[1]");
  expect(
    pathBelowPage(index.collectionItems("ListPage.items.archive")[1]!, index)
  ).toBe("items[1]");
});
