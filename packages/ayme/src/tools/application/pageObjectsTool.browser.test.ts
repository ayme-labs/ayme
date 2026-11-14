import { afterEach, describe, expect, it, vi } from "vitest";

import { registerCompiledPom } from "../../page-objects/application";
import { createPage } from "../../page-objects/infrastructure";
import { rooted } from "../../test-utils/pomRoot.testSupport";
import { startSession } from "../../test-utils/session.testSupport";

const action = (toolName: string) => ({
  methodName: toolName.split(".").at(-1)!,
  toolName,
  description: `${toolName} does it.`,
  parameters: [],
  returnPoms: [],
});

describe("page_objects on a real page", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  /**
   * A shopping list: its heading, an `Item` per row with its name, and a
   * search box, which is no Page Object Child.
   */
  function shoppingList(...names: string[]) {
    document.body.innerHTML = `
      <h1>Groceries</h1>
      <input aria-label="Search" value="milk">
      <ul>${names.map((name) => `<li><span>${name}</span><button>Archive</button></li>`).join("")}</ul>
      <section aria-label="Totals"><p>${names.length} items</p></section>`;
    const page = createPage();
    const session = startSession(page);
    const archived = vi.fn();
    class ShoppingListPage {
      title = page.getByRole("heading");
      totals = page.getByRole("region", { name: "Totals" });
      get items() {
        return names.map((_, index) => {
          const root = page.locator("li").nth(index);
          return rooted(root, {
            name: root.locator("span"),
            archive: async () =>
              archived(await root.locator("span").textContent()),
          });
        });
      }
    }
    registerCompiledPom(ShoppingListPage, {
      className: "ShoppingListPage",
      tools: [],
      members: [
        {
          memberName: "title",
          kind: "locator",
          access: "field",
          collection: false,
        },
        {
          memberName: "totals",
          kind: "locator",
          access: "field",
          collection: false,
        },
        {
          memberName: "items",
          kind: "component",
          access: "getter",
          componentClassName: "Item",
          collection: true,
        },
      ],
      components: [
        {
          className: "Item",
          members: [
            {
              memberName: "root",
              kind: "locator",
              access: "field",
              collection: false,
            },
            {
              memberName: "name",
              kind: "locator",
              access: "field",
              collection: false,
            },
          ],
          tools: [action("Item.archive")],
        },
      ],
    });
    session.register(ShoppingListPage);
    return { ...session, archived };
  }

  it("is listed as a tool with no parameters", () => {
    const { ayme, stop } = shoppingList("Milk");
    try {
      expect(
        ayme.tools.list().find(({ name }) => name === "page_objects")
      ).toMatchObject({
        name: "page_objects",
        inputSchema: { type: "object", properties: {} },
        available: true,
      });
    } finally {
      stop();
    }
  });

  it("answers the Page Objects as a tree: classes, declared children with their values, and ids", async () => {
    const { ayme, stop } = shoppingList("Milk", "Eggs");
    try {
      const text = (await ayme.tools.run("page_objects", {})) as string;

      // The document's ids go on across tests: read the two this one gave.
      const [milk, eggs] = [...text.matchAll(/Item (po\d+)/g)].map(
        (match) => match[1]!
      );
      expect(text).toBe(
        [
          "ShoppingListPage",
          '  title: heading "Groceries" [level=1]',
          '  totals: region "Totals":',
          "    - paragraph: 2 items",
          "  items:",
          `    - Item ${milk}`,
          "        name: text: Milk",
          `    - Item ${eggs}`,
          "        name: text: Eggs",
        ].join("\n")
      );
      expect(text).not.toMatch(/archive|Search|"type"|e\d+/);
    } finally {
      stop();
    }
  });

  it("prints ids that the Page Object's tools accept", async () => {
    const { ayme, stop, archived } = shoppingList("Milk", "Eggs");
    try {
      const text = (await ayme.tools.run("page_objects", {})) as string;
      const eggs = /Item (po\d+)\n {8}name: text: Eggs/.exec(text)?.[1];

      await ayme.tools.run("Item.archive", { id: eggs, args: {} });

      expect(archived.mock.calls).toEqual([["Eggs"]]);
    } finally {
      stop();
    }
  });
});
