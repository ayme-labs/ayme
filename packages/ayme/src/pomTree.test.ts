// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { Locator } from "@playwright/test";

import { createPage } from "./browserPage";
import type { PomComponentManifest, PomManifest } from "./contracts";
import { ayme } from "./decorators";
import { rooted } from "./pomRoot.testSupport";
import {
  observePageObject,
  pomGroups,
  resolveTargets,
  rootTargetPath,
} from "./pomTree";

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
  methodName,
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
  tools: [action("expand")],
};
const label: PomComponentManifest = {
  className: "Label",
  members: [],
  tools: [action("rename")],
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

describe("the places of a Page Object's tools", () => {
  it("lists each place once, a group's own before its nested ones, and ends a path at a class that repeats", () => {
    expect(
      pomGroups(fileTree).map(({ key, toolPath, collectionKey }) => ({
        key,
        toolPath,
        collectionKey,
      }))
    ).toEqual([
      { key: "items[]", toolPath: "items", collectionKey: "items[]" },
      {
        key: "items[].label",
        toolPath: "items.label",
        collectionKey: "items[]",
      },
    ]);
  });
});

describe("one observation of a Page Object", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("follows a class that repeats to every depth, and files its instances under its first occurrence", async () => {
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

    const { instances } = await observePageObject(tree, fileTree);
    const byPath = new Map(
      instances.map((instance) => [instance.path, instance])
    );

    expect(
      instances.map(({ path, componentPath }) => [path, componentPath])
    ).toEqual([
      ["", undefined],
      ["items[0]", "items[]"],
      ["items[0].children[0]", "items[]"],
      ["items[0].children[0].children[0]", "items[]"],
      ["items[0].children[0].children[0].label", "items[].label"],
      ["items[0].children[0].label", "items[].label"],
      ["items[0].label", "items[].label"],
    ]);
    // Each item is the one a ref to its root names, and its children act
    // through it.
    const lib = byPath.get("items[0].children[0]");
    expect(lib?.item).toBe(lib);
    expect(byPath.get("items[0].children[0].label")?.item).toBe(lib);
  });

  it("keeps an instance of a repeated class out of its first occurrence without a root of its own", async () => {
    document.body.innerHTML = '<ul><li id="src">src</li></ul>';
    // The nested item's root predicate answers no locator.
    const nested = rooted(undefined as unknown as Locator, {
      children: [],
      label: new Label(),
    });
    const tree = { items: [item("#src", [nested])] };

    const { instances, memberObservations } = await observePageObject(
      tree,
      fileTree
    );

    const found = instances.find(({ path }) => path === "items[0].children[0]");
    expect(found?.componentPath).toBe("items[].children[]");
    expect(found?.present).toBe(false);
    expect(memberObservations).toContainEqual({
      memberName: "items[0].children[0].root",
      kind: "component-root",
      count: 0,
      error:
        "POM component items[0].children[0]'s root is not a browser locator.",
    });
  });

  it("files a class that repeats without a collection under no tool's place, but still observes it", async () => {
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
          tools: [action("open")],
        },
      ],
    };
    const root = new Node(
      page.locator("#outer"),
      new Node(page.locator("#inner"))
    );

    const { instances } = await observePageObject({ node: root }, manifest);

    expect(pomGroups(manifest).map(({ key }) => key)).toEqual(["node"]);
    expect(
      instances.map(({ path, componentPath }) => [path, componentPath])
    ).toEqual([
      ["", undefined],
      ["node", "node"],
      ["node.child", "node.child"],
    ]);
  });

  it("stops at an object it has already walked on the way down", async () => {
    document.body.innerHTML = '<ul><li id="src">src</li></ul>';
    const src = item("#src");
    src.children.push(src);

    const { instances } = await observePageObject({ items: [src] }, fileTree);

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

    const { targetSources } = await observePageObject(tree, fileTree);

    expect(
      resolveTargets(targetSources).map(({ path, element }) => [
        path,
        element.id,
      ])
    ).toEqual([
      [rootTargetPath("FileTree.items[0]"), "src"],
      [rootTargetPath("FileTree.items[0].children[0]"), "lib"],
    ]);
  });
});
