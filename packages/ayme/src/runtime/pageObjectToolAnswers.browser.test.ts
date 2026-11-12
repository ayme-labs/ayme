import { afterEach, describe, expect, it, vi } from "vitest";

import { registerCompiledPom } from "../page-objects/application";
import { createPage } from "../page-objects/infrastructure";
import { rooted } from "../test-utils/pomRoot.testSupport";
import { callers, errorText, type ToolInfo } from "../shared";
import { createAyme } from "./runtime";

// Runtime seam: a Page Object Tool as an agent calls it through WebMCP
// publication and through the Ayme MCP server's page client, each reached
// through the source the session hands that channel's package.

type Source = {
  list(): readonly ToolInfo[];
  run(name: string, input: unknown): Promise<unknown>;
};

// The two packages load as stand-ins that keep the source they are handed.
const handed = vi.hoisted(() => ({
  webMcp: undefined as Source | undefined,
  aymeMcp: undefined as Source | undefined,
}));
vi.mock("./webMcp", () => ({
  loadWebMcpPublication: async () => ({
    startWebMcpPublication: (tools: Source) => {
      handed.webMcp = tools;
      return { retry: async () => {} };
    },
  }),
}));
vi.mock("./agentConnection", () => ({
  loadAgentConnection: async () => ({
    startAgentConnection: ({ tools }: { tools: Source }) => {
      handed.aymeMcp = tools;
      return { dispose() {} };
    },
  }),
  loadProcessConnection: async () => ({
    startAgentConnection: () => ({ dispose() {} }),
  }),
}));

const action = (toolName: string) => ({
  methodName: toolName.split(".").at(-1)!,
  toolName,
  parameters: [],
  returnPoms: [],
});

describe("a Page Object Tool's answer through both agent channels", () => {
  let stop = () => {};
  afterEach(() => {
    stop();
    handed.webMcp = handed.aymeMcp = undefined;
    document.body.innerHTML = "";
  });

  /**
   * A shopping list whose `add` adds a row, `archive` removes its own and
   * `rename` fails, started with both channels, once each has its source.
   */
  async function shoppingList(...names: string[]) {
    document.body.innerHTML = `<h1>Groceries</h1><ul>${names
      .map((name) => `<li><span>${name}</span></li>`)
      .join("")}</ul>`;
    const rows = [...names];
    const page = createPage();
    class ShoppingListPage {
      title = page.getByRole("heading");
      get items() {
        return rows.map((_, index) => {
          const root = page.locator("li").nth(index);
          return rooted(root, {
            name: root.locator("span"),
            archive: async () => {
              rows.splice(index, 1);
              document.querySelectorAll("li")[index]!.remove();
            },
          });
        });
      }
      async add(name: string) {
        rows.push(name);
        document
          .querySelector("ul")!
          .insertAdjacentHTML("beforeend", `<li><span>${name}</span></li>`);
        return rows.length;
      }
      async rename() {
        document.querySelector("h1")!.textContent = "Errands";
        throw new Error("The list cannot be renamed.");
      }
    }
    registerCompiledPom(ShoppingListPage, {
      className: "ShoppingListPage",
      tools: [
        {
          ...action("ShoppingListPage.add"),
          parameters: [
            { name: "name", optional: false, schema: { type: "string" } },
          ],
        },
        action("ShoppingListPage.rename"),
      ],
      members: [
        {
          memberName: "title",
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
    const ayme = createAyme({
      pageFactory: () => page,
      webMCP: { enabled: true },
      agentConnection: true,
      pageObjects: [ShoppingListPage],
    });
    stop = ayme.start();
    await vi.waitFor(() => {
      expect(handed.webMcp).toBeDefined();
      expect(handed.aymeMcp).toBeDefined();
    });
    await vi.waitFor(() =>
      expect(ayme.tools.list().map(({ name }) => name)).toContain(
        "ShoppingListPage.add"
      )
    );
    return { ayme, webMcp: handed.webMcp!, aymeMcp: handed.aymeMcp! };
  }

  /** The id `page_objects` shows for the row named `name`. */
  async function idOf(ayme: { tools: Source }, name: string) {
    const tree = (await ayme.tools.run("page_objects", {})) as string;
    const id = new RegExp(`Item (po\\d+)\\n +name: text: ${name}`).exec(
      tree
    )?.[1];
    if (!id) throw new Error(`No id for ${name} in:\n${tree}`);
    return id;
  }

  it("is the same short answer through WebMCP and through ayme mcp: settled, the result, and the Page Object that appeared in full with its id", async () => {
    const { ayme, webMcp, aymeMcp } = await shoppingList("Milk");

    const throughWebMcp = await webMcp.run("ShoppingListPage.add", {
      name: "Eggs",
    });
    const eggs = await idOf(ayme, "Eggs");
    const throughAymeMcp = await aymeMcp.run("ShoppingListPage.add", {
      name: "Bread",
    });
    const bread = await idOf(ayme, "Bread");

    const added = (id: string, name: string, count: number) => ({
      settled: true,
      result: count,
      changes: [
        "ShoppingListPage",
        "  items:",
        `    + Item ${id}`,
        `        name: text: ${name}`,
      ].join("\n"),
    });
    expect(throughWebMcp).toEqual(added(eggs, "Eggs", 2));
    expect(throughAymeMcp).toEqual(added(bread, "Bread", 3));
  });

  it("marks a Page Object that went away, and leaves out the URL and loading while neither changed", async () => {
    const { ayme, webMcp, aymeMcp } = await shoppingList("Milk", "Eggs", "Tea");
    const milk = await idOf(ayme, "Milk");
    const eggs = await idOf(ayme, "Eggs");

    const answers = [
      await webMcp.run("Item.archive", { id: milk }),
      await aymeMcp.run("Item.archive", { id: eggs }),
    ];

    expect(answers).toEqual([
      {
        settled: true,
        changes: `ShoppingListPage\n  items:\n    - Item ${milk} (removed)`,
      },
      {
        settled: true,
        changes: `ShoppingListPage\n  items:\n    - Item ${eggs} (removed)`,
      },
    ]);
  });

  it("refuses with the reason alone, and fails with what failed alone, in both channels", async () => {
    const { ayme, webMcp, aymeMcp } = await shoppingList("Milk", "Eggs");
    const milk = await idOf(ayme, "Milk");
    await ayme.tools.run("Item.archive", { id: milk });
    const failureOf = (call: Promise<unknown>) =>
      call.then(
        () => {
          throw new Error("Expected the call to fail.");
        },
        (error: unknown) => errorText(error)
      );

    for (const channel of [webMcp, aymeMcp]) {
      const gone = await failureOf(channel.run("Item.archive", { id: milk }));
      expect(gone).toMatch(new RegExp(`${milk}`));
      expect(gone).not.toMatch(/changes|snapshot|page_objects|\n/);

      const failed = await failureOf(
        channel.run("ShoppingListPage.rename", {})
      );
      expect(failed).toBe("The list cannot be renamed.");
    }
  });

  it("leaves ayme.tools.run's full record as it is", async () => {
    const { ayme } = await shoppingList("Milk");

    const record = await ayme.tools.run(
      "ShoppingListPage.add",
      { name: "Eggs" },
      { by: callers.webmcp }
    );

    expect(record).toMatchObject({
      settled: true,
      page_changed: true,
      result: 2,
    });
    expect(record).toHaveProperty("changes");
  });
});
