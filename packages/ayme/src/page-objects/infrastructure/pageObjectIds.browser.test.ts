import { afterEach, describe, expect, it, vi } from "vitest";

import { createPage } from "./browserPage";
import { rooted } from "../../test-utils/pomRoot.testSupport";
import {
  registerCompiledPom,
  listAvailablePomTools,
  probeRegisteredPomMembers,
} from "./registry";
import { getPageStateForDocument } from "../../page-state/infrastructure";
import { runContext } from "../../test-utils/agentCalls.testSupport";
import { startSession } from "../../test-utils/session.testSupport";

const action = (methodName: string) => ({
  methodName: methodName.split(".").at(-1)!,
  toolName: methodName,
  description: methodName,
  parameters: [],
  returnPoms: [],
});

/** The id the page state prints on each `Item` root, by the item's text. */
async function itemIds(): Promise<Record<string, string>> {
  await probeRegisteredPomMembers();
  const { text } = await getPageStateForDocument(document);
  return Object.fromEntries(
    [...text.matchAll(/ Item (po\d+): (\w+)/g)].map((match) => [
      match[2]!,
      match[1]!,
    ])
  );
}

/** The `n` of the id `po<n>`. The document's ids go on across these tests. */
const numberOf = (id: string | undefined) => Number(id?.slice(2));

describe("Page Object ids on a real page", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  /** A list whose every `li` is an `Item`, archived by the text it shows. */
  function list(...texts: string[]) {
    document.body.innerHTML = `<ul>${texts.map((text) => `<li>${text}</li>`).join("")}</ul>`;
    const page = createPage();
    const session = startSession(page);
    const archived = vi.fn();
    class ItemsPage {
      get items() {
        return [...document.querySelectorAll("li")].map((_, index) => {
          const root = page.locator("li").nth(index);
          return rooted(root, {
            archive: async () => archived(await root.textContent()),
          });
        });
      }
    }
    registerCompiledPom(ItemsPage, {
      className: "ItemsPage",
      tools: [],
      members: [
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
          members: [{ memberName: "root", kind: "locator", access: "field" }],
          tools: [action("Item.archive")],
        },
      ],
    });
    session.register(ItemsPage);
    const archive = async (id: string) => {
      await probeRegisteredPomMembers();
      const tool = listAvailablePomTools().find(
        ({ name }) => name === "Item.archive"
      );
      if (!tool) throw new Error("Expected Item.archive.");
      return tool.execute({ id }, runContext());
    };
    return { session, archived, archive };
  }

  it("prints an id on each Page Object Root, numbered in the order the page shows them", async () => {
    const { session } = list("Milk", "Eggs", "Tea");
    try {
      const ids = await itemIds();

      expect(Object.keys(ids)).toEqual(["Milk", "Eggs", "Tea"]);
      const first = numberOf(ids.Milk);
      expect(first).toBeGreaterThan(0);
      expect(ids).toEqual({
        Milk: `po${first}`,
        Eggs: `po${first + 1}`,
        Tea: `po${first + 2}`,
      });
    } finally {
      session.stop();
    }
  });

  it("runs a rooted tool on the Page Object an id names", async () => {
    const { session, archived, archive } = list("Milk", "Eggs", "Tea");
    try {
      const ids = await itemIds();

      await archive(ids.Eggs!);

      expect(archived.mock.calls).toEqual([["Eggs"]]);
    } finally {
      session.stop();
    }
  });

  it("keeps a Page Object's id while its root stays on the page, and gives a new one a new id", async () => {
    const { session, archived, archive } = list("Milk", "Eggs", "Tea");
    try {
      const before = await itemIds();
      const items = document.querySelector("ul")!;
      // Milk leaves, the others move up, and Rice arrives first in the list.
      items.querySelector("li")!.remove();
      const rice = document.createElement("li");
      rice.textContent = "Rice";
      items.prepend(rice);

      expect(await itemIds()).toEqual({
        Rice: `po${numberOf(before.Tea) + 1}`,
        Eggs: before.Eggs,
        Tea: before.Tea,
      });
      await archive(before.Tea!);
      expect(archived.mock.calls).toEqual([["Tea"]]);
    } finally {
      session.stop();
    }
  });

  it("fails a call by the id of a Page Object that is gone, and never gives its id to another", async () => {
    const { session, archived, archive } = list("Milk", "Eggs");
    try {
      const before = await itemIds();
      const items = document.querySelector("ul")!;
      items.querySelector("li")!.remove();
      // A new element takes the place Milk had in the list.
      const milk = document.createElement("li");
      milk.textContent = "Milk";
      items.prepend(milk);

      await expect(archive(before.Milk!)).rejects.toMatchObject({
        name: "RefResolutionError",
        message: `Cannot call Item.archive on Page Object "${before.Milk}": it is not on the page.`,
      });
      expect(archived).not.toHaveBeenCalled();
      expect(await itemIds()).toEqual({
        Milk: `po${numberOf(before.Eggs) + 1}`,
        Eggs: before.Eggs,
      });
    } finally {
      session.stop();
    }
  });
});
