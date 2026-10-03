// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "./browserPage";

import {
  configureAymeRuntime,
  createPageRegistration,
  listRegisteredPomTargets,
  registerCompiledPom,
} from "./registry";

describe("registered Page Object targets", () => {
  afterEach(() => {
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
    const page = createPage();
    configureAymeRuntime(page);

    const item = (index: number) => {
      const root = page.locator(".item").nth(index);
      return {
        root,
        nameButton: root.locator("button"),
        tags: index === 0 ? [{ root: root.locator(".tag") }] : [],
      };
    };
    class ListPage {
      readonly root = page.locator("main");
      readonly newItemInput = page.locator(".new");
      readonly header = {
        root: page.locator("header"),
        title: page.locator("h1"),
      };
      readonly items = [item(0), item(1)];
    }
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
    const registration = createPageRegistration(ListPage);

    const targets = await listRegisteredPomTargets();
    const [milk, eggs] = document.querySelectorAll(".item");

    expect(targets.map(({ path }) => path)).toEqual([
      "ListPage.root",
      "ListPage.newItemInput",
      "ListPage.header.root",
      "ListPage.header.title",
      "ListPage.items[0].root",
      "ListPage.items[0].nameButton",
      "ListPage.items[0].tags[0].root",
      "ListPage.items[1].root",
      "ListPage.items[1].nameButton",
    ]);
    expect(
      targets
        .filter(({ element }) => element === milk || element === eggs)
        .map(({ path }) => path)
    ).toEqual(["ListPage.items[0].root", "ListPage.items[1].root"]);

    registration.dispose();
  });
});
