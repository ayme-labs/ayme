import { rootRef } from "../../test-utils/agentCalls.testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PomManifest, ToolManifest } from "../../shared";
import {
  ayme as model,
  createPage,
  registerCompiledPom,
} from "../../page-objects";
import { rootOf } from "../../test-utils/pomRoot.testSupport";
import { agentTools } from "../../test-utils/publication.testSupport";
import {
  startSession,
  type TestSession,
} from "../../test-utils/session.testSupport";

// Runtime object seam: a Change Record names a Page Object Root the way the
// snapshot does, so an agent reading only the diff can tell which Page Object
// it touched.

type ActionResultShape = {
  page_changed: boolean;
  settled: boolean;
  changes_before?: string;
  changes?: string;
};

describe("Page Object labels in a Change Record, in Chromium", () => {
  let page: ReturnType<typeof createPage>;
  let session: TestSession | undefined;

  beforeEach(() => {
    document.body.innerHTML = "";
    page = createPage();
  });

  afterEach(() => {
    session?.stop();
    session = undefined;
    document.body.innerHTML = "";
  });

  const list = () => document.querySelector("ul")!;
  const addItem = (name: string) =>
    list().insertAdjacentHTML("beforeend", `<li>${name}</li>`);

  /**
   * A shopping list whose ListPage, rooted on `<main>`, adds an item and
   * removes the banner, a Page Object of its own; `extra` Page Objects share
   * ListPage's root.
   */
  function startShoppingList(...extra: string[]) {
    document.body.innerHTML = `
      <main>
        <h1>Shopping list</h1>
        <aside>Welcome</aside>
        <ul><li>Milk</li></ul>
      </main>
    `;
    const currentPage = page;
    class ListPage {
      root = currentPage.locator("main");
      addItem() {
        addItem("Eggs");
      }
      dismissBanner() {
        document.querySelector("aside")?.remove();
      }
      clearList() {
        document.querySelector("ul")?.remove();
      }
    }
    model({ root: rootOf })(ListPage);
    class Banner {
      root = currentPage.locator("aside");
    }
    model({ root: rootOf })(Banner);
    registerCompiledPom(
      ListPage,
      manifest("ListPage", [
        action("addItem", "ListPage.addItem"),
        action("dismissBanner", "ListPage.dismissBanner"),
        action("clearList", "ListPage.clearList"),
      ])
    );
    registerCompiledPom(Banner, manifest("Banner", []));
    const sharing = extra.map((name) => {
      const Shared = class {
        root = currentPage.locator("main");
      };
      model({ root: rootOf })(Shared);
      registerCompiledPom(Shared, manifest(name, []));
      return Shared;
    });
    session = startSession(page);
    session.register(ListPage);
    session.register(Banner);
    for (const Shared of sharing) session.register(Shared);
    return session;
  }

  async function readStructure(): Promise<string> {
    const context = (await agentTools().call("snapshot", {})) as {
      structure: string;
    };
    return context.structure;
  }

  const run = async (tool: string) =>
    (await agentTools().call(tool, {
      ref: await rootRef(tool.slice(0, tool.lastIndexOf("."))),
      args: {},
    })) as ActionResultShape;

  /** The first line of a rendered forest: the root's own line. */
  const firstLine = (text: string | undefined) => text?.split("\n")[0];

  it("labels the root of an action's changes as the snapshot does", async () => {
    startShoppingList();
    await readStructure();

    const result = await run("ListPage.addItem");
    const structure = await readStructure();

    expect(firstLine(result.changes)).toMatch(/^- e\d+ ListPage:$/);
    expect(structure).toContain(firstLine(result.changes));
    expect(result.changes).toContain("<added> listitem: Eggs");
  });

  it("labels a removed Page Object Root with the name it had", async () => {
    startShoppingList();
    await readStructure();

    const result = await run("ListPage.dismissBanner");

    expect(result.changes).toMatch(/- e\d+ Banner <removed>: Welcome/);
  });

  it("shows the pom property the snapshot shows when Page Objects share a root", async () => {
    startShoppingList("Cart");
    const structure = await readStructure();
    const pom = '  - /pom: ["Cart","ListPage"]';
    expect(structure).toContain(pom);

    const result = await run("ListPage.addItem");

    expect(result.changes!.split("\n").slice(0, 2)).toEqual([
      structure.split("\n")[0],
      pom,
    ]);
  });

  it("labels a removed root by a Page Object registered after the Caller last looked", async () => {
    const { register } = startShoppingList();
    await readStructure();
    const currentPage = page;
    class Panel {
      root = currentPage.locator("aside");
    }
    model({ root: rootOf })(Panel);
    registerCompiledPom(Panel, manifest("Panel", []));
    register(Panel);

    const result = await run("ListPage.dismissBanner");

    expect(result.changes).toMatch(
      /- e\d+ <removed> complementary:\n\s+- \/pom: \["Banner","Panel"\]/
    );
  });

  it("labels a removed root by a Page Object moved onto it after the Caller last looked", async () => {
    const { register } = startShoppingList();
    const currentPage = page;
    let target = "h1";
    class Panel {
      get root() {
        return currentPage.locator(target);
      }
    }
    model({ root: rootOf })(Panel);
    registerCompiledPom(Panel, manifest("Panel", []));
    register(Panel);
    expect(await readStructure()).toMatch(/- e\d+ Panel "Shopping list"/);
    target = "ul";

    const result = await run("ListPage.clearList");

    expect(result.changes).toMatch(/- e\d+ Panel <removed>:/);
  });

  it("labels the root in changes_before too", async () => {
    startShoppingList();
    await readStructure();

    addItem("Bread");
    const result = await run("ListPage.addItem");

    expect(firstLine(result.changes_before)).toMatch(/^- e\d+ ListPage:$/);
    expect(result.changes_before).toContain("<added> listitem: Bread");
  });
});

const action = (methodName: string, toolName: string): ToolManifest => ({
  methodName,
  toolName,
  description: methodName,
  parameters: [],
});

const manifest = (className: string, tools: ToolManifest[]): PomManifest => ({
  className,
  members: [{ memberName: "root", kind: "locator", access: "field" }],
  tools,
  components: [],
});
