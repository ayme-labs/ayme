import { expect, it } from "vitest";

import { buildStructureTree } from "./structure";

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

it("builds the tree of nodes with their refs, roles and names", () => {
  const { roots, refCount } = buildStructureTree(pageState, new Map());

  expect(roots).toEqual([
    {
      ref: "e56",
      role: "generic",
      name: "",
      children: [
        {
          ref: "e57",
          role: "main",
          name: "",
          children: [
            { ref: "e58", role: "heading", name: "Groceries", children: [] },
            {
              ref: "e1",
              role: "generic",
              name: "",
              children: [
                { role: "text", name: "New item", children: [] },
                { ref: "e2", role: "textbox", name: "New item", children: [] },
              ],
            },
            { ref: "e3", role: "button", name: "Add item", children: [] },
            {
              ref: "e59",
              role: "list",
              name: "Items",
              children: [
                {
                  ref: "e74",
                  role: "listitem",
                  name: "",
                  children: [{ role: "text", name: "Milk", children: [] }],
                },
                {
                  ref: "e75",
                  role: "link",
                  name: 'Say "hi"',
                  children: [{ role: "text", name: "Note: one", children: [] }],
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

it("tags each node with the Page Object member it maps to", () => {
  const { roots } = buildStructureTree(
    pageState,
    new Map([
      ["e2", "ListPage.newItemInput"],
      ["e74", "ListPage.items[0]"],
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
