import { describe, expect, it } from "vitest";

import {
  buildStructureTree,
  collectionItems,
  mapMembersToRefs,
  memberLinks,
  memberTag,
  pageObjectsOf,
  type StructureNode,
} from "./structure";

// Unit tests: the structure tree model built from the page state text an
// agent receives. The fixture is hand-written in its compact notation.

const pageState = `- e56:
  - e57 main:
    - e58 heading "Groceries" [level=1]
    - e1 ListPage:
      - text: New item
      - e2 textbox "New item"
    - e3 button "Add item" [cursor=pointer]
    - e59 list "Items":
      - e74 listitem: Milk
      - e75 link "Say \\"hi\\"":
        - /pom: ["ListItem", "Other"]
        - text: "Note: one"`;

/** The tree without what an agent reads of each node, tested on its own. */
function withoutPageStateLines(nodes: readonly StructureNode[]): unknown[] {
  return nodes.map((node) => {
    const rest: Partial<StructureNode> = { ...node };
    delete rest.pageStateLines;
    delete rest.childCount;
    return { ...rest, children: withoutPageStateLines(node.children) };
  });
}

it("builds the tree of nodes with their refs, roles and names", () => {
  const { roots, refCount } = buildStructureTree(pageState, new Map());

  expect(withoutPageStateLines(roots)).toEqual([
    {
      ref: "e56",
      role: "generic",
      name: "",
      members: [],
      children: [
        {
          ref: "e57",
          role: "main",
          name: "",
          members: [],
          children: [
            {
              ref: "e58",
              role: "heading",
              name: "Groceries",
              states: ["level=1"],
              members: [],
              children: [],
            },
            {
              ref: "e1",
              role: "generic",
              name: "",
              members: [],
              children: [
                { role: "text", name: "New item", members: [], children: [] },
                {
                  ref: "e2",
                  role: "textbox",
                  name: "New item",
                  members: [],
                  children: [],
                },
              ],
            },
            {
              ref: "e3",
              role: "button",
              name: "Add item",
              states: ["cursor=pointer"],
              members: [],
              children: [],
            },
            {
              ref: "e59",
              role: "list",
              name: "Items",
              members: [],
              children: [
                {
                  ref: "e74",
                  role: "listitem",
                  name: "",
                  members: [],
                  children: [
                    { role: "text", name: "Milk", members: [], children: [] },
                  ],
                },
                {
                  ref: "e75",
                  role: "link",
                  name: 'Say "hi"',
                  members: [],
                  children: [
                    {
                      role: "text",
                      name: "Note: one",
                      members: [],
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ]);
  expect(refCount).toBe(9);
});

it("keeps what an agent reads of each node alone: its line, its properties and how many entries nest under it", () => {
  const { roots } = buildStructureTree(pageState, new Map());
  const main = roots[0]!.children[0]!;
  const [heading, listPage, addItem, list] = main.children;

  expect(heading).toMatchObject({
    pageStateLines: ['- e58 heading "Groceries" [level=1]'],
    childCount: 0,
  });
  expect(listPage).toMatchObject({
    pageStateLines: ["- e1 ListPage:"],
    childCount: 2,
  });
  expect(addItem).toMatchObject({
    pageStateLines: ['- e3 button "Add item" [cursor=pointer]'],
    childCount: 0,
  });
  expect(list!.children[0]).toMatchObject({
    pageStateLines: ["- e74 listitem: Milk"],
    childCount: 0,
  });
  expect(list!.children[1]).toMatchObject({
    pageStateLines: [
      '- e75 link "Say \\"hi\\"":',
      '  - /pom: ["ListItem", "Other"]',
    ],
    childCount: 1,
  });
  expect(main).toMatchObject({ childCount: 4 });
});

it("tags each node with the Page Object member it maps to", () => {
  const { roots } = buildStructureTree(
    pageState,
    new Map([
      ["e2", ["ListPage.newItemInput"]],
      ["e74", ["ListPage.items[0]", "ListPage.items", "ListItem"]],
    ])
  );

  const main = roots[0]!.children[0]!;
  expect(main.children[1]!.children[1]).toMatchObject({
    ref: "e2",
    member: "ListPage.newItemInput",
  });
  expect(main.children[3]!.children[0]).toMatchObject({
    ref: "e74",
    member: "ListPage.items[0]",
  });
  expect(main.children[2]).not.toHaveProperty("member");
});

describe("when several members locate the same elements", () => {
  // Two collections over the same list items, and a locator over them too,
  // as the registry lists their targets: each path, then its aliases.
  const page = `- e1 list "Items":
  - e2 listitem: Milk
  - e3 listitem: Eggs`;
  const [milk, eggs] = [
    document.createElement("li"),
    document.createElement("li"),
  ];
  const elementsByRef: [string, Element][] = [
    ["e1", document.createElement("ul")],
    ["e2", milk!],
    ["e3", eggs!],
  ];
  const targets = [
    { path: "ListPage.rows", element: milk! },
    { path: "ListPage.rows", element: eggs! },
    { path: "ListPage.items[0].root", element: milk! },
    { path: "ListPage.items", element: milk! },
    { path: "ListItem", element: milk! },
    { path: "ListPage.items[1].root", element: eggs! },
    { path: "ListPage.entries[0].root", element: milk! },
    { path: "ListPage.entries[1].root", element: eggs! },
  ];
  const structure = buildStructureTree(
    page,
    mapMembersToRefs(elementsByRef, targets)
  );
  const [milkNode, eggsNode] = structure.roots[0]!.children;

  it("maps each element to every member that locates it", () => {
    expect(milkNode!.members).toEqual([
      "ListPage.rows",
      "ListPage.items[0]",
      "ListPage.items",
      "ListItem",
      "ListPage.entries[0]",
    ]);
    expect(eggsNode!.members).toEqual([
      "ListPage.rows",
      "ListPage.items[1]",
      "ListPage.entries[1]",
    ]);
  });

  it("finds each collection's items, whatever order the members were registered in", () => {
    expect(collectionItems(structure, "ListPage.items")).toEqual([
      { path: "ListPage.items[0]", index: 0, indices: [0], ref: "e2" },
      { path: "ListPage.items[1]", index: 1, indices: [1], ref: "e3" },
    ]);
    expect(collectionItems(structure, "ListPage.entries")).toEqual([
      { path: "ListPage.entries[0]", index: 0, indices: [0], ref: "e2" },
      { path: "ListPage.entries[1]", index: 1, indices: [1], ref: "e3" },
    ]);
    expect(collectionItems(structure, "ListPage.rows")).toEqual([]);
  });

  it("tags a node with its most specific member, the first registered on a tie", () => {
    expect(milkNode!.member).toBe("ListPage.items[0]");
    expect(memberTag(["ListPage.rows", "ListPage.entries[1]"])).toBe(
      "ListPage.entries[1]"
    );
    expect(
      memberTag(["ListPage.items[1]", "ListPage.items[1].nameButton"])
    ).toBe("ListPage.items[1].nameButton");
  });
});

describe("where each of a node's members leads", () => {
  // As the registry lists a page with a collection of ListItem components:
  // each root under its path, its collection and its class.
  const pageObjects = pageObjectsOf(
    ["ListPage"],
    [
      { path: "ListPage.newItemInput" },
      { path: "ListPage.items[0].root" },
      { path: "ListPage.items" },
      { path: "ListPage.items.root" },
      { path: "ListItem.root" },
      { path: "ListPage.items[0].nameButton" },
      { path: "ListPage.items.nameButton" },
      { path: "ListItem.nameButton" },
      { path: "ListPage.archiveDialog.root" },
    ]
  );
  const links = (members: string[]) =>
    memberLinks(members, memberTag(members)!, pageObjects);

  it("leads a locator to the instance it is declared on", () => {
    expect(links(["ListPage.newItemInput"])).toEqual([
      { member: "ListPage.newItemInput", owner: { object: "ListPage" } },
    ]);
  });

  it("leads a component's root to that instance, and its class to the model", () => {
    expect(links(["ListPage.items", "ListPage.items[0]", "ListItem"])).toEqual([
      { member: "ListPage.items[0]", owner: { object: "ListPage.items[0]" } },
      { member: "ListItem", owner: { model: "ListItem" } },
    ]);
  });

  it("leads a component's member to its item, and its class alias to the model", () => {
    expect(
      links([
        "ListPage.items[0].nameButton",
        "ListPage.items.nameButton",
        "ListItem.nameButton",
      ])
    ).toEqual([
      {
        member: "ListPage.items[0].nameButton",
        owner: { object: "ListPage.items[0]" },
      },
      { member: "ListItem.nameButton", owner: { model: "ListItem" } },
    ]);
  });

  it("leads a single component to itself", () => {
    expect(links(["ListPage.archiveDialog"])).toEqual([
      {
        member: "ListPage.archiveDialog",
        owner: { object: "ListPage.archiveDialog" },
      },
    ]);
  });

  it("leads a collection alias with no item beside it to the object declaring the collection", () => {
    expect(links(["ListPage.items.nameButton"])).toEqual([
      { member: "ListPage.items.nameButton", owner: { object: "ListPage" } },
    ]);
  });
});

describe("a collection inside a collection's items", () => {
  // Two list items, each with its own tags: ListPage.items[].tags[].
  const page = `- e1 list "Items":
  - e2 listitem:
    - e3 button "urgent"
    - e4 button "home"
  - e5 listitem:
    - e6 button "work"`;
  const members = new Map<string, string[]>([
    ["e2", ["ListPage.items[0]"]],
    ["e3", ["ListPage.items[0].tags[0]", "ListPage.items.tags", "Tag"]],
    ["e4", ["ListPage.items[0].tags[1]", "ListPage.items.tags", "Tag"]],
    ["e5", ["ListPage.items[1]"]],
    ["e6", ["ListPage.items[1].tags[0]", "ListPage.items.tags", "Tag"]],
  ]);
  const structure = buildStructureTree(page, members);

  it("finds every item's tags, in index order", () => {
    expect(collectionItems(structure, "ListPage.items[].tags")).toEqual([
      {
        path: "ListPage.items[0].tags[0]",
        index: 0,
        indices: [0, 0],
        ref: "e3",
      },
      {
        path: "ListPage.items[0].tags[1]",
        index: 1,
        indices: [0, 1],
        ref: "e4",
      },
      {
        path: "ListPage.items[1].tags[0]",
        index: 0,
        indices: [1, 0],
        ref: "e6",
      },
    ]);
  });

  it("accepts the collection written with its own brackets", () => {
    expect(
      collectionItems(structure, "ListPage.items[].tags[]").map(
        ({ path }) => path
      )
    ).toEqual([
      "ListPage.items[0].tags[0]",
      "ListPage.items[0].tags[1]",
      "ListPage.items[1].tags[0]",
    ]);
  });

  it("finds one item's tags when scoped to that item", () => {
    expect(
      collectionItems(structure, "ListPage.items[1].tags").map(
        ({ path, ref }) => [path, ref]
      )
    ).toEqual([["ListPage.items[1].tags[0]", "e6"]]);
  });

  it("finds the outer items without their tags", () => {
    expect(
      collectionItems(structure, "ListPage.items").map(({ path }) => path)
    ).toEqual(["ListPage.items[0]", "ListPage.items[1]"]);
  });
});
