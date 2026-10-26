// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { Locator } from "@playwright/test";

import { createPage } from "../infrastructure/browserPage";
import type { PomComponentManifest, PomManifest } from "../../shared";
import { ayme } from "../domain/decorators";
import { rooted } from "../../test-utils/pomRoot.testSupport";
import { rootTargetPath } from "../domain/pomTree";
import { observePageObject, resolveTargets } from "./pomTreeWalk";
import { litePageDriver } from "../infrastructure/litePageDriver";

const page = createPage();

const locator = (memberName: string) =>
  ({ memberName, kind: "locator", access: "field" }) as const;
const component = (
  memberName: string,
  componentClassName: string,
  collection = false
) =>
  ({
    memberName,
    kind: "component",
    access: "field",
    componentClassName,
    collection,
  }) as const;
const action = (methodName: string) => ({
  methodName: methodName.split(".").at(-1)!,
  toolName: methodName,
  parameters: [],
});

// A file tree whose items hold items of their own class, at any depth.
const treeItem: PomComponentManifest = {
  className: "TreeItem",
  members: [
    locator("root"),
    component("children", "TreeItem", true),
    component("label", "Label"),
  ],
  tools: [action("TreeItem.expand")],
};
const label: PomComponentManifest = {
  className: "Label",
  members: [],
  tools: [action("Label.rename")],
};
const fileTree: PomManifest = {
  className: "FileTree",
  members: [component("items", "TreeItem", true)],
  tools: [],
  components: [treeItem, label],
};

/** A tree item at `selector`, holding `children` and a root-less label. */
function item(selector: string, children: object[] = []) {
  return rooted(page.locator(selector), {
    children,
    label: new Label(),
  });
}
class Label {}

describe("one observation of a Page Object", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("follows a class that repeats to every depth and keeps each concrete path", async () => {
    document.body.innerHTML = `
      <ul>
        <li id="src">src
          <ul><li id="lib">lib<ul><li id="util">util.ts</li></ul></li></ul>
        </li>
      </ul>
    `;
    const tree = {
      items: [item("#src", [item("#lib", [item("#util")])])],
    };

    const { instances } = await observePageObject(
      litePageDriver,
      tree,
      fileTree
    );

    expect(instances.map(({ path, className }) => [path, className])).toEqual([
      ["", "FileTree"],
      ["items[0]", "TreeItem"],
      ["items[0].children[0]", "TreeItem"],
      ["items[0].children[0].children[0]", "TreeItem"],
      ["items[0].children[0].children[0].label", "Label"],
      ["items[0].children[0].label", "Label"],
      ["items[0].label", "Label"],
    ]);
  });

  it("observes a nested instance whose root answers no locator", async () => {
    document.body.innerHTML = '<ul><li id="src">src</li></ul>';
    // The nested item's root predicate answers no locator.
    const nested = rooted(undefined as unknown as Locator, {
      children: [],
      label: new Label(),
    });
    const tree = { items: [item("#src", [nested])] };

    const { instances, memberObservations } = await observePageObject(
      litePageDriver,
      tree,
      fileTree
    );

    const found = instances.find(({ path }) => path === "items[0].children[0]");
    expect(found?.className).toBe("TreeItem");
    expect(found?.present).toBe(false);
    expect(memberObservations).toContainEqual({
      memberName: "items[0].children[0].root",
      kind: "component-root",
      count: 0,
      error:
        "TreeItem at FileTree.items[0].children[0]: its root is not a browser locator.",
    });
  });

  it("observes a class that repeats without a collection", async () => {
    document.body.innerHTML =
      '<section id="outer"><section id="inner"></section></section>';
    class Node {
      constructor(
        readonly root: Locator,
        readonly child?: Node
      ) {}
    }
    ayme({ root: (self: Node) => self.root })(Node);
    const manifest: PomManifest = {
      className: "Page",
      members: [component("node", "Node")],
      tools: [],
      components: [
        {
          className: "Node",
          members: [locator("root"), component("child", "Node")],
          tools: [action("Node.open")],
        },
      ],
    };
    const root = new Node(
      page.locator("#outer"),
      new Node(page.locator("#inner"))
    );

    const { instances } = await observePageObject(
      litePageDriver,
      { node: root },
      manifest
    );

    expect(instances.map(({ path, className }) => [path, className])).toEqual([
      ["", "Page"],
      ["node", "Node"],
      ["node.child", "Node"],
    ]);
  });

  it("stops at an object it has already walked on the way down", async () => {
    document.body.innerHTML = '<ul><li id="src">src</li></ul>';
    const src = item("#src");
    src.children.push(src);

    const { instances } = await observePageObject(
      litePageDriver,
      { items: [src] },
      fileTree
    );

    expect(instances.map(({ path }) => path)).toEqual([
      "",
      "items[0]",
      "items[0].children[0]",
      "items[0].label",
    ]);
  });

  it("lists the roots and members of every instance it walks as targets", async () => {
    document.body.innerHTML = `
      <ul><li id="src">src<ul><li id="lib">lib</li></ul></li></ul>
    `;
    const tree = { items: [item("#src", [item("#lib")])] };

    const { targetSources } = await observePageObject(
      litePageDriver,
      tree,
      fileTree
    );

    expect(
      resolveTargets(litePageDriver, targetSources).map(({ path, element }) => [
        path,
        element.id,
      ])
    ).toEqual([
      [rootTargetPath("FileTree.items[0]"), "src"],
      [rootTargetPath("FileTree.items[0].children[0]"), "lib"],
    ]);
  });
});
