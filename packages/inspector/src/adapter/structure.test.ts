import { describe, expect, it } from "vitest";

import {
  buildStructureTree,
  collectionItems,
  mapMembersToRefs,
  memberLinks,
  memberOwnersOf,
  memberTag,
  type StructureNode,
} from "./structure";
import type { PageObjectModel, PageObjectNode } from "./pageModel";

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

/** A page model node with what owning members reads of it. */
function objectNode(
  path: string,
  kind: PageObjectNode["kind"],
  className: string,
  children: PageObjectNode[] = []
): PageObjectNode {
  const name = path.slice(path.lastIndexOf(".") + 1);
  return {
    path,
    key: path,
    name,
    kind,
    className,
    live: true,
    members: [],
    actions: [],
    children,
  };
}

/** A Page Object Model with its members' paths. */
function model(className: string, members: string[]): PageObjectModel {
  return {
    className,
    members: members.map((name) => ({
      name,
      kind: "locator",
      path: `${className}.${name}`,
    })),
    actions: [],
    instancePaths: [],
  };
}

describe("where each of a node's members leads", () => {
  // A page with a collection of ListItem components and an archive dialog.
  // The members are the ones the registry lists for a node: its path, its
  // collection's and its class's.
  const owners = memberOwnersOf({
    objects: [
      objectNode("ListPage", "page", "ListPage", [
        objectNode("ListPage.items", "collection", "ListItem", [
          objectNode("ListPage.items[0]", "item", "ListItem"),
        ]),
        objectNode("ListPage.archiveDialog", "component", "ArchiveDialog"),
      ]),
    ],
    models: [
      model("ListPage", ["newItemInput", "items", "archiveDialog"]),
      model("ListItem", ["nameButton"]),
      model("ArchiveDialog", ["confirmButton"]),
    ],
  });
  const links = (members: string[]) =>
    memberLinks(members, memberTag(members)!, owners);

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

  it("leads each of two collections' items over the same element to its item", () => {
    // As the registry lists a node that ListPage.items and ListPage.entries
    // both hold, with a locator over it too.
    const twoCollections = memberOwnersOf({
      objects: [
        objectNode("ListPage", "page", "ListPage", [
          objectNode("ListPage.items", "collection", "ListItem", [
            objectNode("ListPage.items[0]", "item", "ListItem"),
          ]),
          objectNode("ListPage.entries", "collection", "ListItem", [
            objectNode("ListPage.entries[0]", "item", "ListItem"),
          ]),
        ]),
      ],
      models: [
        model("ListPage", ["rows", "items", "entries"]),
        model("ListItem", ["nameButton"]),
      ],
    });
    const members = [
      "ListPage.rows",
      "ListPage.items[0]",
      "ListPage.items",
      "ListItem",
      "ListPage.entries[0]",
      "ListPage.entries",
    ];
    expect(memberLinks(members, memberTag(members)!, twoCollections)).toEqual([
      { member: "ListPage.items[0]", owner: { object: "ListPage.items[0]" } },
      { member: "ListPage.rows", owner: { object: "ListPage" } },
      { member: "ListItem", owner: { model: "ListItem" } },
      {
        member: "ListPage.entries[0]",
        owner: { object: "ListPage.entries[0]" },
      },
    ]);
  });

  it("leaves out a member the page model doesn't know yet", () => {
    expect(links(["ListPage.items[0]", "Unknown.thing"])).toEqual([
      { member: "ListPage.items[0]", owner: { object: "ListPage.items[0]" } },
    ]);
  });
});

describe("a member in a collection nested in a collection's items", () => {
  // Page.lists[].items[]: List components, each with a collection of Item
  // components, and a button on each item.
  const owners = memberOwnersOf({
    objects: [
      objectNode("Page", "page", "Page", [
        objectNode("Page.lists", "collection", "List", [
          objectNode("Page.lists[0]", "item", "List", [
            objectNode("Page.lists[0].items", "collection", "Item", [
              objectNode("Page.lists[0].items[0]", "item", "Item"),
              objectNode("Page.lists[0].items[1]", "item", "Item"),
            ]),
          ]),
        ]),
      ]),
    ],
    models: [
      model("Page", ["lists"]),
      model("List", ["items"]),
      model("Item", ["button"]),
    ],
  });
  const { roots } = buildStructureTree(
    '- e1 button "Done"',
    new Map([
      [
        "e1",
        [
          "Page.lists[0].items[1].button",
          "Page.lists[0].items.button",
          "Page.lists.items.button",
          "List.items.button",
          "Item.button",
        ],
      ],
    ]),
    owners
  );

  it("is owned by its item", () => {
    expect(roots[0]).toMatchObject({
      member: "Page.lists[0].items[1].button",
      owner: "Page.lists[0].items[1]",
    });
  });

  it("leads to its item, leaving out the collection aliases, and its class paths to their models", () => {
    expect(roots[0]!.memberLinks).toEqual([
      {
        member: "Page.lists[0].items[1].button",
        owner: { object: "Page.lists[0].items[1]" },
      },
      { member: "List.items.button", owner: { model: "List" } },
      { member: "Item.button", owner: { model: "Item" } },
    ]);
  });
});

describe("a component whose class is also a page on the page", () => {
  // Header is a page Page Object of its own, and ListPage uses the same class
  // for its header component.
  const owners = memberOwnersOf({
    objects: [
      objectNode("ListPage", "page", "ListPage", [
        objectNode("ListPage.header", "component", "Header"),
      ]),
      objectNode("Header", "page", "Header"),
    ],
    models: [model("ListPage", ["header"]), model("Header", ["title"])],
  });
  const links = (members: string[]) =>
    memberLinks(members, memberTag(members)!, owners);

  it("leads the component's root to the component, and its class to the model", () => {
    expect(links(["ListPage.header", "Header"])).toEqual([
      { member: "ListPage.header", owner: { object: "ListPage.header" } },
      { member: "Header", owner: { model: "Header" } },
    ]);
  });

  it("leads the component's member to the component, and its class path to the model", () => {
    expect(links(["ListPage.header.title", "Header.title"])).toEqual([
      { member: "ListPage.header.title", owner: { object: "ListPage.header" } },
      { member: "Header.title", owner: { model: "Header" } },
    ]);
  });

  it("leads the page's own members to the page", () => {
    expect(links(["Header"])).toEqual([
      { member: "Header", owner: { object: "Header" } },
    ]);
    expect(links(["Header.title"])).toEqual([
      { member: "Header.title", owner: { object: "Header" } },
    ]);
  });

  it("leads each page's member over the same element to its own page", () => {
    expect(links(["ListPage.searchInput", "Header.searchInput"])).toEqual([
      { member: "ListPage.searchInput", owner: { object: "ListPage" } },
      { member: "Header.searchInput", owner: { object: "Header" } },
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
