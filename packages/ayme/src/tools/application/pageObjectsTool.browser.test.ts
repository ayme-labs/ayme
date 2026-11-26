import { afterEach, describe, expect, it, vi } from "vitest";

import { registerCompiledPom } from "../../page-objects/application";
import { createPage } from "../../page-objects/infrastructure";
import { rooted, rootOf } from "../../../testing/pomRoot.testSupport";
import { ayme as decorate } from "../../page-objects/domain";
import { startSession } from "../../../testing/session.testSupport";

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

  it("shows a present Page Object inside one that is not, in its place, with an id its tools accept", async () => {
    // The page's shell is gone; its dialog, portaled to the body, is not.
    document.body.innerHTML = `
      <div role="dialog" aria-label="Delete"><h2>Delete the list?</h2></div>`;
    const page = createPage();
    const session = startSession(page);
    const confirmed = vi.fn();
    class ShellPage {
      root = page.locator("main");
      dialog = rooted(page.getByRole("dialog"), {
        heading: page.getByRole("dialog").getByRole("heading"),
        confirm: async () => confirmed(),
      });
    }
    decorate({ root: rootOf })(ShellPage);
    registerCompiledPom(ShellPage, {
      className: "ShellPage",
      tools: [],
      members: [
        {
          memberName: "root",
          kind: "locator",
          access: "field",
          collection: false,
        },
        {
          memberName: "dialog",
          kind: "component",
          access: "field",
          componentClassName: "Dialog",
          collection: false,
        },
      ],
      components: [
        {
          className: "Dialog",
          members: [
            {
              memberName: "root",
              kind: "locator",
              access: "field",
              collection: false,
            },
            {
              memberName: "heading",
              kind: "locator",
              access: "field",
              collection: false,
            },
          ],
          tools: [action("Dialog.confirm")],
        },
      ],
    });
    session.register(ShellPage);
    try {
      await expect
        .poll(
          () =>
            session.ayme.tools
              .list()
              .find(({ name }) => name === "Dialog.confirm")?.available
        )
        .toBe(true);
      const text = (await session.ayme.tools.run("page_objects", {})) as string;
      const dialog = /^Dialog (po\d+)$/m.exec(text)?.[1];

      expect(text).toBe(
        [
          `Dialog ${dialog}`,
          '  heading: heading "Delete the list?" [level=2]',
        ].join("\n")
      );
      await session.ayme.tools.run("Dialog.confirm", { id: dialog, args: {} });
      expect(confirmed).toHaveBeenCalledOnce();
    } finally {
      session.stop();
    }
  });

  it("reads a declared span of text whose parent took in its text, and one whose role is presentation or none", async () => {
    document.body.innerHTML = `
      <h1>Account</h1>
      <div><span class="note">Milk</span></div>
      <div><span class="note" role="presentation">Eggs</span></div>
      <div><span class="note" role="none">Tea</span></div>`;
    const page = createPage();
    const session = startSession(page);
    class AccountPage {
      notes = page.locator(".note");
    }
    registerCompiledPom(AccountPage, {
      className: "AccountPage",
      tools: [],
      members: [
        {
          memberName: "notes",
          kind: "locator",
          access: "field",
          collection: true,
        },
      ],
      components: [],
    });
    session.register(AccountPage);
    try {
      const text = (await session.ayme.tools.run("page_objects", {})) as string;

      expect(text).toBe(
        [
          "AccountPage",
          "  notes:",
          "    - text: Milk",
          "    - text: Eggs",
          "    - text: Tea",
        ].join("\n")
      );
    } finally {
      session.stop();
    }
  });

  it("leaves out a declared child's element in an excluded subtree", async () => {
    document.body.innerHTML = `
      <h1>Account</h1>
      <p><span>Visible note</span></p>
      <p data-ayme-exclude><span>Secret note</span></p>`;
    const page = createPage();
    const session = startSession(page);
    class AccountPage {
      notes = page.locator("p span");
    }
    registerCompiledPom(AccountPage, {
      className: "AccountPage",
      tools: [],
      members: [
        {
          memberName: "notes",
          kind: "locator",
          access: "field",
          collection: true,
        },
      ],
      components: [],
    });
    session.register(AccountPage);
    try {
      const text = (await session.ayme.tools.run("page_objects", {})) as string;

      expect(text).toBe(
        ["AccountPage", "  notes:", "    - text: Visible note"].join("\n")
      );
    } finally {
      session.stop();
    }
  });
});
