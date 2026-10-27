// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPage } from "./browserPage";

import { ayme } from "../domain/decorators";
import { alwaysReaches } from "../../test-utils/reach.testSupport";
import { rooted, rootOf } from "../../test-utils/pomRoot.testSupport";
import { rootTargetPath } from "../domain/pomTree";
import { listRegisteredPomTargets, registerCompiledPom } from "./registry";
import {
  startSession,
  type TestSession,
} from "../../test-utils/session.testSupport";

describe("registered Page Object targets", () => {
  let page: ReturnType<typeof createPage>;
  let session: TestSession;
  beforeEach(() => {
    page = createPage();
    session = startSession(page, { reach: alwaysReaches() });
  });
  afterEach(() => {
    session.stop();
    document.body.innerHTML = "";
  });

  it("lists each element at its concrete member paths only", async () => {
    document.body.innerHTML = `
      <main>
        <input class="new" />
        <ul>
          <li class="item"><button>Milk</button><span class="tag">a</span></li>
          <li class="item"><button>Eggs</button></li>
        </ul>
        <header><h1>List</h1></header>
      </main>
    `;

    const item = (index: number) => {
      const root = page.locator(".item").nth(index);
      return rooted(root, {
        nameButton: root.locator("button"),
        tags: index === 0 ? [rooted(root.locator(".tag"), {})] : [],
      });
    };
    class ListPage {
      readonly root = page.locator("main");
      readonly newItemInput = page.locator(".new");
      readonly header = rooted(page.locator("header"), {
        title: page.locator("h1"),
      });
      readonly items = [item(0), item(1)];
    }
    ayme({ root: rootOf })(ListPage);
    registerCompiledPom(ListPage, {
      className: "ListPage",
      tools: [],
      members: [
        { memberName: "root", kind: "locator", access: "field" },
        { memberName: "newItemInput", kind: "locator", access: "field" },
        {
          memberName: "header",
          kind: "component",
          access: "field",
          componentClassName: "Header",
          collection: false,
        },
        {
          memberName: "items",
          kind: "component",
          access: "field",
          componentClassName: "ListItem",
          collection: true,
        },
      ],
      components: [
        {
          className: "Header",
          members: [
            { memberName: "root", kind: "locator", access: "field" },
            { memberName: "title", kind: "locator", access: "field" },
          ],
          tools: [],
        },
        {
          className: "ListItem",
          members: [
            { memberName: "root", kind: "locator", access: "field" },
            { memberName: "nameButton", kind: "locator", access: "field" },
            {
              memberName: "tags",
              kind: "component",
              access: "field",
              componentClassName: "Tag",
              collection: true,
            },
          ],
          tools: [],
        },
        {
          className: "Tag",
          members: [{ memberName: "root", kind: "locator", access: "field" }],
          tools: [],
        },
      ],
    });
    session.register(ListPage);

    const targets = await listRegisteredPomTargets();
    const [milk, eggs] = document.querySelectorAll(".item");

    expect(targets.map(({ path }) => path)).toEqual([
      rootTargetPath("ListPage"),
      "ListPage.newItemInput",
      rootTargetPath("ListPage.header"),
      "ListPage.header.title",
      rootTargetPath("ListPage.items[0]"),
      "ListPage.items[0].nameButton",
      rootTargetPath("ListPage.items[0].tags[0]"),
      rootTargetPath("ListPage.items[1]"),
      "ListPage.items[1].nameButton",
    ]);
    expect(
      targets
        .filter(({ element }) => element === milk || element === eggs)
        .map(({ path }) => path)
    ).toEqual([
      rootTargetPath("ListPage.items[0]"),
      rootTargetPath("ListPage.items[1]"),
    ]);
  });

  it("keeps the root target apart from a member named root that is not the root", async () => {
    document.body.innerHTML = `
      <section><p class="root">Intro</p></section>
    `;
    class Editor {
      readonly container = page.locator("section");
      readonly root = page.locator(".root");
    }
    ayme({ root: (self: Editor) => self.container })(Editor);
    registerCompiledPom(Editor, {
      className: "Editor",
      tools: [],
      members: [
        { memberName: "container", kind: "locator", access: "field" },
        { memberName: "root", kind: "locator", access: "field" },
      ],
      components: [],
    });
    session.register(Editor);

    const targets = await listRegisteredPomTargets();

    expect(rootTargetPath("Editor")).not.toBe("Editor.root");
    expect(targets.map(({ path, element }) => [path, element.tagName])).toEqual(
      [
        [rootTargetPath("Editor"), "SECTION"],
        ["Editor.root", "P"],
      ]
    );
  });

  it("names each target's member locator, as an Interaction on it names it", async () => {
    document.body.innerHTML = `
      <ul><li class="item"><button>Milk</button></li></ul>
    `;
    class ListPage {
      readonly addItemButton = page.getByRole("button", { name: "Milk" });
      readonly items = [rooted(page.locator(".item").nth(0), {})];
    }
    registerCompiledPom(ListPage, {
      className: "ListPage",
      tools: [],
      members: [
        { memberName: "addItemButton", kind: "locator", access: "field" },
        {
          memberName: "items",
          kind: "component",
          access: "field",
          componentClassName: "ListItem",
          collection: true,
        },
      ],
      components: [
        {
          className: "ListItem",
          members: [{ memberName: "root", kind: "locator", access: "field" }],
          tools: [],
        },
      ],
    });
    session.register(ListPage);

    const targets = await listRegisteredPomTargets();

    expect(targets.map(({ path, locator }) => ({ path, locator }))).toEqual([
      {
        path: "ListPage.addItemButton",
        locator: "getByRole('button', { name: 'Milk' })",
      },
      {
        path: rootTargetPath("ListPage.items[0]"),
        locator: "locator('.item').first()",
      },
    ]);
  });

  it("reads the latest observation until the page changes, and a change made just before at once", async () => {
    document.body.innerHTML = '<ul><li class="item">Milk</li></ul>';
    let rootReads = 0;
    class ListPage {
      readonly items = page.locator(".item");
    }
    ayme({
      root: () => {
        rootReads += 1;
        return page.locator("ul");
      },
    })(ListPage);
    registerCompiledPom(ListPage, {
      className: "ListPage",
      tools: [],
      members: [{ memberName: "items", kind: "locator", access: "field" }],
      components: [],
    });
    session.register(ListPage);
    const items = async () =>
      (await listRegisteredPomTargets())
        .filter(({ path }) => path === "ListPage.items")
        .map(({ element }) => element.textContent);

    expect(await items()).toEqual(["Milk"]);
    const reads = rootReads;
    expect(await items()).toEqual(["Milk"]);
    expect(rootReads).toBe(reads);

    document
      .querySelector("ul")!
      .insertAdjacentHTML("beforeend", '<li class="item">Eggs</li>');
    expect(await items()).toEqual(["Milk", "Eggs"]);
  });

  it("lists what a member's locator holds now, after a change no observation follows", async () => {
    document.body.innerHTML = '<input type="checkbox" class="done" />';
    class Todo {
      readonly checked = page.locator(".done:checked");
    }
    registerCompiledPom(Todo, {
      className: "Todo",
      tools: [],
      members: [{ memberName: "checked", kind: "locator", access: "field" }],
      components: [],
    });
    session.register(Todo);
    const checked = async () =>
      (await listRegisteredPomTargets()).map(({ path }) => path);

    expect(await checked()).toEqual([]);
    document.querySelector<HTMLInputElement>(".done")!.checked = true;
    expect(await checked()).toEqual(["Todo.checked"]);
  });

  it("leaves out a member whose locator cannot be resolved, and lists the rest", async () => {
    document.body.innerHTML = '<input class="name" />';
    class Form {
      readonly broken = page.locator("[");
      readonly name = page.locator(".name");
    }
    registerCompiledPom(Form, {
      className: "Form",
      tools: [],
      members: [
        { memberName: "broken", kind: "locator", access: "field" },
        { memberName: "name", kind: "locator", access: "field" },
      ],
      components: [],
    });
    session.register(Form);

    const targets = await listRegisteredPomTargets();

    expect(targets.map(({ path }) => path)).toEqual(["Form.name"]);
  });

  it("lists a member apart from the root only while it holds another element than the root, after a change no observation follows", async () => {
    document.body.innerHTML = `
      <input type="checkbox" id="a" checked />
      <input type="checkbox" id="b" />
    `;
    class Todos {
      readonly checked = page.locator("input:checked");
    }
    ayme({ root: () => page.locator("#a") })(Todos);
    registerCompiledPom(Todos, {
      className: "Todos",
      tools: [],
      members: [{ memberName: "checked", kind: "locator", access: "field" }],
      components: [],
    });
    session.register(Todos);
    const [a, b] = document.querySelectorAll("input");
    const targets = async () =>
      (await listRegisteredPomTargets()).map(({ path, element }) => [
        path,
        element.id,
      ]);

    expect(await targets()).toEqual([[rootTargetPath("Todos"), "a"]]);
    a.checked = false;
    b.checked = true;
    expect(await targets()).toEqual([
      [rootTargetPath("Todos"), "a"],
      ["Todos.checked", "b"],
    ]);
    a.checked = true;
    b.checked = false;
    expect(await targets()).toEqual([[rootTargetPath("Todos"), "a"]]);
  });
});
