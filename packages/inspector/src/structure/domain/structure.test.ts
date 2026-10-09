import { describe, expect, it } from "vitest";

import { indexMembers } from "../../page-model";
import { forest, node } from "../test-utils/projected";
import {
  collection,
  component,
  model,
  page,
  type Contents,
} from "../../page-model/test-utils/pageModel";
import { mapTargetsToRefs } from "../../shared";
import { buildStructureTree } from "../infrastructure/structureTree";
import { type StructureNode } from "./structure";

// Unit tests: the structure tree model built from the projected page state
// an agent's text is rendered from. The fixture is hand-written.

// As the page state text renders it:
// - e56:
//   - e57 main:
//     - e58 heading "Groceries" [level=1]
//     - e1 ListPage:
//       - text: New item
//       - e2 textbox "New item"
//     - e3 button "Add item" [cursor=pointer]
//     - e59 list "Items":
//       - e74 listitem: Milk
//       - e75 link "Say \"hi\"":
//         - /pom: ["ListItem","Other"]
//         - text: "Note: one"
const pageState = forest(
  node(
    { ref: "e56" },
    node(
      { ref: "e57", role: "main" },
      node({
        ref: "e58",
        role: "heading",
        name: "Groceries",
        state: { level: 1 },
      }),
      node(
        { ref: "e1", label: "ListPage" },
        "New item",
        node({ ref: "e2", role: "textbox", name: "New item" })
      ),
      node({
        ref: "e3",
        role: "button",
        name: "Add item",
        cursorPointer: true,
      }),
      node(
        { ref: "e59", role: "list", name: "Items" },
        node({ ref: "e74", role: "listitem" }, "Milk"),
        node(
          {
            ref: "e75",
            role: "link",
            name: 'Say "hi"',
            pom: ["ListItem", "Other"],
          },
          "Note: one"
        )
      )
    )
  )
);

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
              state: { level: 1 },
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
      '  - /pom: ["ListItem","Other"]',
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
      ["e74", ["ListPage.items[0].root"]],
    ]),
    indexMembers({
      objects: [
        page("ListPage", {
          locators: ["newItemInput"],
          children: [collection("items", "ListItem", [{}])],
        }),
      ],
      models: [],
    })
  );

  const main = roots[0]!.children[0]!;
  expect(main.children[1]!.children[1]).toMatchObject({
    ref: "e2",
    members: ["ListPage.newItemInput"],
    member: "ListPage.newItemInput",
    tag: ".newItemInput",
    owner: "ListPage",
  });
  expect(main.children[3]!.children[0]).toMatchObject({
    ref: "e74",
    members: ["ListPage.items[0]"],
    member: "ListPage.items[0]",
    tag: "[·]",
    owner: "ListPage.items[0]",
  });
  expect(main.children[2]).not.toHaveProperty("member");
});

describe("when several members locate the same elements", () => {
  // Two collections over the same list items, and a locator over them too,
  // as the registry lists their targets.
  const listState = forest(
    node(
      { ref: "e1", role: "list", name: "Items" },
      node({ ref: "e2", role: "listitem" }, "Milk"),
      node({ ref: "e3", role: "listitem" }, "Eggs")
    )
  );
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
    { path: "ListPage.items[1].root", element: eggs! },
    { path: "ListPage.entries[0].root", element: milk! },
    { path: "ListPage.entries[1].root", element: eggs! },
  ];
  const twoItems: Contents[] = [{}, {}];
  const index = indexMembers({
    objects: [
      page("ListPage", {
        locators: ["rows"],
        children: [
          collection("items", "ListItem", twoItems),
          collection("entries", "ListItem", twoItems),
        ],
      }),
    ],
    models: [model("ListPage", ["rows", "items", "entries"])],
  });
  const structure = buildStructureTree(
    listState,
    mapTargetsToRefs(elementsByRef, targets),
    index
  );
  const [milkNode, eggsNode] = structure.roots[0]!.children;

  it("maps each ref to every target whose element it is, in the registry's order", () => {
    expect(mapTargetsToRefs(elementsByRef, targets)).toEqual(
      new Map([
        [
          "e2",
          [
            "ListPage.rows",
            "ListPage.items[0].root",
            "ListPage.entries[0].root",
          ],
        ],
        [
          "e3",
          [
            "ListPage.rows",
            "ListPage.items[1].root",
            "ListPage.entries[1].root",
          ],
        ],
      ])
    );
  });

  it("maps each element to every member that locates it", () => {
    expect(milkNode!.members).toEqual([
      "ListPage.rows",
      "ListPage.items[0]",
      "ListPage.entries[0]",
    ]);
    expect(eggsNode!.members).toEqual([
      "ListPage.rows",
      "ListPage.items[1]",
      "ListPage.entries[1]",
    ]);
  });

  it("tags a node with its most specific member, the first registered on a tie", () => {
    expect(milkNode!.member).toBe("ListPage.items[0]");
    expect(eggsNode!.member).toBe("ListPage.items[1]");
  });

  it("leads each member to its own instance, and the items' class to its model", () => {
    expect(milkNode!.memberLinks).toEqual([
      { member: "ListPage.items[0]", owner: { object: "ListPage.items[0]" } },
      { member: "ListPage.rows", owner: { object: "ListPage" } },
      { member: "ListItem", owner: { model: "ListItem" } },
      {
        member: "ListPage.entries[0]",
        owner: { object: "ListPage.entries[0]" },
      },
    ]);
  });
});

/** The node a single ref's targets make of a button e1, with its links. */
function nodeOf(
  targets: string[],
  objects: Parameters<typeof indexMembers>[0]["objects"]
) {
  const { roots } = buildStructureTree(
    forest(node({ ref: "e1", role: "button" })),
    new Map([["e1", targets]]),
    indexMembers({ objects, models: [] })
  );
  return roots[0]!;
}

describe("where each of a node's members leads", () => {
  // A page with a collection of ListItem components and an archive dialog.
  const listPage = [
    page("ListPage", {
      locators: ["newItemInput"],
      children: [
        collection("items", "ListItem", [{ locators: ["nameButton"] }]),
        component("archiveDialog", "ArchiveDialog", {
          locators: ["confirmButton"],
        }),
      ],
    }),
  ];
  const links = (targets: string[]) => nodeOf(targets, listPage).memberLinks;

  it("leads a locator to the instance it is declared on", () => {
    expect(links(["ListPage.newItemInput"])).toEqual([
      { member: "ListPage.newItemInput", owner: { object: "ListPage" } },
    ]);
  });

  it("leads a component's root to that instance, and its class to the model", () => {
    expect(links(["ListPage.items[0].root"])).toEqual([
      { member: "ListPage.items[0]", owner: { object: "ListPage.items[0]" } },
      { member: "ListItem", owner: { model: "ListItem" } },
    ]);
    expect(links(["ListPage.archiveDialog.root"])).toEqual([
      {
        member: "ListPage.archiveDialog",
        owner: { object: "ListPage.archiveDialog" },
      },
      { member: "ArchiveDialog", owner: { model: "ArchiveDialog" } },
    ]);
  });

  it("leads a component's member to its item, and its class's member to the model", () => {
    expect(links(["ListPage.items[0].nameButton"])).toEqual([
      {
        member: "ListPage.items[0].nameButton",
        owner: { object: "ListPage.items[0]" },
      },
      { member: "ListItem.nameButton", owner: { model: "ListItem" } },
    ]);
  });

  it("tags an item's member over the item's own root", () => {
    expect(
      nodeOf(
        ["ListPage.items[0].root", "ListPage.items[0].nameButton"],
        listPage
      )
    ).toMatchObject({
      member: "ListPage.items[0].nameButton",
      tag: "[·].nameButton",
      owner: "ListPage.items[0]",
    });
  });

  it("leaves out a target the page model doesn't have yet", () => {
    expect(
      nodeOf(["ListPage.items[1].root", "ListPage.items[0].root"], listPage)
    ).toMatchObject({
      members: ["ListPage.items[0]"],
      member: "ListPage.items[0]",
    });
    expect(nodeOf(["ListPage.items[1].root"], listPage)).toMatchObject({
      members: [],
    });
    expect(nodeOf(["ListPage.items[1].root"], listPage)).not.toHaveProperty(
      "member"
    );
  });
});

describe("a member in a collection nested in a collection's items", () => {
  // Page.lists[].items[]: List components, each with a collection of Item
  // components, and a button on each item.
  const node = nodeOf(
    ["Page.lists[0].items[1].button"],
    [
      page("Page", {
        children: [
          collection("lists", "List", [
            {
              children: [
                collection("items", "Item", [
                  { locators: ["button"] },
                  { locators: ["button"] },
                ]),
              ],
            },
          ]),
        ],
      }),
    ]
  );

  it("is owned by its item", () => {
    expect(node).toMatchObject({
      member: "Page.lists[0].items[1].button",
      tag: "[·].items[1].button",
      owner: "Page.lists[0].items[1]",
    });
  });

  it("leads to its item, and to the models of the Page Objects holding it", () => {
    expect(node.memberLinks).toEqual([
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
  const pages = [
    page("ListPage", {
      locators: ["searchInput"],
      children: [component("header", "Header", { locators: ["title"] })],
    }),
    page("Header", { locators: ["title", "searchInput"] }),
  ];
  const links = (targets: string[]) => nodeOf(targets, pages).memberLinks;

  it("leads the component's root to the component, and its class to the model", () => {
    expect(links(["ListPage.header.root"])).toEqual([
      { member: "ListPage.header", owner: { object: "ListPage.header" } },
      { member: "Header", owner: { model: "Header" } },
    ]);
  });

  it("leads the component's member to the component, and its class's member to the model", () => {
    expect(links(["ListPage.header.title"])).toEqual([
      { member: "ListPage.header.title", owner: { object: "ListPage.header" } },
      { member: "Header.title", owner: { model: "Header" } },
    ]);
  });

  it("leads the page's own members to the page", () => {
    expect(links(["Header.root"])).toEqual([
      { member: "Header", owner: { object: "Header" } },
    ]);
    expect(links(["Header.title"])).toEqual([
      { member: "Header.title", owner: { object: "Header" } },
    ]);
  });

  it("tags a page's root with the page", () => {
    expect(nodeOf(["Header.root"], pages)).toMatchObject({
      member: "Header",
      tag: "Header",
      owner: "Header",
    });
  });

  it("leads another page's item over the same element to that item", () => {
    // App.list is a ListPage component, and a ListPage page is registered
    // over the same list.
    const listItem: Contents[] = [{}];
    expect(
      nodeOf(
        ["App.list.items[0].root", "ListPage.items[0].root"],
        [
          page("App", {
            children: [
              component("list", "ListPage", {
                children: [collection("items", "ListItem", listItem)],
              }),
            ],
          }),
          page("ListPage", {
            children: [collection("items", "ListItem", listItem)],
          }),
        ]
      ).memberLinks
    ).toEqual([
      { member: "App.list.items[0]", owner: { object: "App.list.items[0]" } },
      { member: "ListPage.items", owner: { model: "ListPage" } },
      { member: "ListItem", owner: { model: "ListItem" } },
      { member: "ListPage.items[0]", owner: { object: "ListPage.items[0]" } },
    ]);
  });

  it("leads each page's member over the same element to its own page", () => {
    expect(links(["ListPage.searchInput", "Header.searchInput"])).toEqual([
      { member: "ListPage.searchInput", owner: { object: "ListPage" } },
      { member: "Header.searchInput", owner: { object: "Header" } },
    ]);
  });
});

describe("several pages over the same element", () => {
  const pages = [
    page("ListPage", {
      children: [component("header", "Header", { locators: ["title"] })],
    }),
    page("Header", { locators: ["title"] }),
  ];

  it("lists a member once, leading where it was first reached", () => {
    // The component's class member "Header.title" comes first, as the
    // model's; the Header page's own member of that path doesn't replace it.
    expect(
      nodeOf(["ListPage.header.title", "Header.title"], pages).memberLinks
    ).toEqual([
      { member: "ListPage.header.title", owner: { object: "ListPage.header" } },
      { member: "Header.title", owner: { model: "Header" } },
    ]);
  });

  it("tags a node with a member inside a collection item over a deeper one outside any", () => {
    const deep = page("App", {
      children: [
        component("shell", "Shell", {
          children: [
            component("main", "Main", {
              children: [component("panel", "Panel", { locators: ["list"] })],
            }),
          ],
        }),
      ],
    });
    const list = page("ListPage", {
      children: [collection("items", "ListItem", [{}])],
    });

    expect(
      nodeOf(
        ["App.shell.main.panel.list", "ListPage.items[0].root"],
        [deep, list]
      ).member
    ).toBe("ListPage.items[0]");
  });
});

describe("what the text parser used to misread", () => {
  it("keeps a lowercase Page Object label out of the role", () => {
    const { roots } = buildStructureTree(
      forest(
        node(
          { ref: "e1", label: "listpage" },
          node({ ref: "e2", role: "button" })
        )
      ),
      new Map()
    );

    expect(roots[0]).toMatchObject({
      role: "generic",
      name: "",
      pageStateLines: ["- e1 listpage:"],
    });
  });

  it("keeps a name that looks like a state in the name", () => {
    const { roots } = buildStructureTree(
      forest(node({ ref: "e1", role: "button", name: "[checked]" })),
      new Map()
    );

    expect(roots[0]).toMatchObject({ role: "button", name: "[checked]" });
    expect(roots[0]).not.toHaveProperty("state");
  });

  it("leaves out a state none of whose values is set", () => {
    const { roots } = buildStructureTree(
      forest(
        node({ ref: "e1", role: "checkbox", state: { checked: undefined } })
      ),
      new Map()
    );

    expect(roots[0]).not.toHaveProperty("state");
  });

  it("gives a node its control's state, and one without a control none", () => {
    const control = { value: "Ada" };
    const { roots } = buildStructureTree(
      forest(
        node({ ref: "e1", role: "textbox" }),
        node({ ref: "e2", role: "button" })
      ),
      new Map(),
      undefined,
      new Map([["e1", control]])
    );

    expect(roots[0]).toHaveProperty("control", control);
    expect(roots[1]).not.toHaveProperty("control");
  });

  it("reads states from the node, not its line", () => {
    const { roots } = buildStructureTree(
      forest(
        node({
          ref: "e1",
          role: "checkbox",
          name: "Done",
          state: { checked: true },
        })
      ),
      new Map()
    );

    expect(roots[0]).toMatchObject({
      state: { checked: true },
      pageStateLines: ['- e1 checkbox "Done" [checked]'],
    });
  });
});
