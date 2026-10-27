import { afterEach, expect, it, vi } from "vitest";

import { registerCompiledPom, probeRegisteredPomMembers } from "./registry";
import { createPage } from "./browserPage";
import { rooted, RootedComponent } from "../../test-utils/pomRoot.testSupport";
import { rootRef } from "../../test-utils/agentCalls.testSupport";
import { startSession } from "../../test-utils/session.testSupport";
import { callers, type PomManifest } from "../../shared";
import { ayme } from "../domain/decorators";
import { geometryReach } from "../../page-state/infrastructure";

it.each([false, true])(
  "withholds a root-less child repeated through a recursive rooted class (collection: %s)",
  async (collection) => {
    const page = createPage();
    const session = startSession(page);
    class Toolbar {
      open() {}
    }
    class TreeItem {
      element = page.locator("section");
      toolbar = new Toolbar();
      next = collection ? [] : undefined;
    }
    ayme({ root: (self: TreeItem) => self.element })(TreeItem);
    const toolbar: PomManifest = {
      className: "Toolbar",
      members: [],
      components: [],
      tools: [{ methodName: "open", toolName: "Toolbar.open", parameters: [] }],
    };
    registerCompiledPom(Toolbar, toolbar);
    const tree: PomManifest = {
      className: "TreeItem",
      tools: [],
      components: [],
      members: [
        {
          memberName: "toolbar",
          kind: "component",
          access: "field",
          componentClassName: "Toolbar",
          collection: false,
        },
        {
          memberName: "next",
          kind: "component",
          access: "field",
          componentClassName: "TreeItem",
          collection,
        },
      ],
    };
    registerCompiledPom(TreeItem, { ...tree, components: [toolbar, tree] });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      session.register(TreeItem);
      await probeRegisteredPomMembers();
      expect(logged).toHaveBeenCalledWith(
        expect.objectContaining({
          message: collection
            ? 'The Page Object class "Toolbar" declares no root and is reached from more than one place: TreeItem.toolbar, TreeItem.next[].toolbar (below a collection).'
            : 'The Page Object class "Toolbar" declares no root and is reached from more than one place: TreeItem.toolbar, TreeItem.next.toolbar.',
        })
      );
      expect(
        session.ayme.tools.list().some(({ name }) => name === "Toolbar.open")
      ).toBe(false);
      await expect(
        session.ayme.tools.run("Toolbar.open", {}, { by: callers.webmcp })
      ).rejects.toThrow('There is no tool "Toolbar.open".');
    } finally {
      logged.mockRestore();
      session.stop();
    }
  }
);

afterEach(() => {
  document.body.innerHTML = "";
});

it("publishes one class tool across member paths and registrations and calls each root", async () => {
  document.body.innerHTML =
    '<button id="a">A</button><button id="b">B</button><button id="c">C</button>';
  const page = createPage();
  const session = startSession(page);
  const called: string[] = [];
  const item = (id: string) =>
    rooted(page.locator(`#${id}`), {
      open() {
        called.push(id);
      },
    });
  class FirstPage {
    first = item("a");
    second = item("b");
  }
  class SecondPage {
    third = item("c");
  }
  const manifest = (className: string, members: string[]): PomManifest => ({
    className,
    tools: [],
    members: members.map((memberName) => ({
      memberName,
      kind: "component",
      access: "field",
      componentClassName: "Item",
      collection: false,
    })),
    components: [
      {
        className: "Item",
        members: [],
        tools: [{ methodName: "open", toolName: "Item.open", parameters: [] }],
      },
    ],
  });
  registerCompiledPom(FirstPage, manifest("FirstPage", ["first", "second"]));
  registerCompiledPom(SecondPage, manifest("SecondPage", ["third"]));
  try {
    session.register(FirstPage);
    session.register(SecondPage);
    await probeRegisteredPomMembers();
    expect(
      session.ayme.tools
        .list()
        .filter((t) => t.group === "pageObject")
        .map(({ name, className }) => ({ name, className }))
    ).toEqual([{ name: "Item.open", className: "Item" }]);
    for (const path of [
      "FirstPage.first",
      "FirstPage.second",
      "SecondPage.third",
    ])
      await session.ayme.tools.run(
        "Item.open",
        { ref: await rootRef(path) },
        { by: callers.webmcp }
      );
    expect(called).toEqual(["a", "b", "c"]);
    session.unregister(FirstPage);
    await probeRegisteredPomMembers();
    expect(
      session.ayme.tools.list().filter(({ name }) => name === "Item.open")
    ).toHaveLength(1);
    await session.ayme.tools.run(
      "Item.open",
      { ref: await rootRef("SecondPage.third") },
      { by: callers.webmcp }
    );
    expect(called).toEqual(["a", "b", "c", "c"]);
    session.unregister(SecondPage);
    expect(
      session.ayme.tools.list().some(({ name }) => name === "Item.open")
    ).toBe(false);
    expect(
      session.ayme.runs.list().filter((run) => run.tool === "Item.open")
    ).toHaveLength(4);
  } finally {
    session.stop();
  }
});

it("offers and calls every recursive instance, coalescing members on the same root", async () => {
  document.body.innerHTML =
    '<section id="outer">Outer<button id="inner">Inner</button></section>';
  const page = createPage();
  const session = startSession(page);
  const called: string[] = [];
  const inner = rooted(page.locator("#inner"), {
    open() {
      called.push("inner");
    },
  });
  Object.assign(inner, { child: inner });
  const outer = rooted(page.locator("#outer"), {
    child: inner,
    open() {
      called.push("outer");
    },
  });
  class TreePage {
    node = outer;
    alias = rooted(page.locator("#inner"), {
      child: inner,
      open() {
        called.push("alias");
      },
    });
  }
  const child = (memberName: string) => ({
    memberName,
    kind: "component" as const,
    access: "field" as const,
    componentClassName: "Node",
    collection: false,
  });
  registerCompiledPom(TreePage, {
    className: "TreePage",
    members: [child("node"), child("alias")],
    tools: [],
    components: [
      {
        className: "Node",
        members: [child("child")],
        tools: [{ methodName: "open", toolName: "Node.open", parameters: [] }],
      },
    ],
  });
  try {
    session.register(TreePage);
    await probeRegisteredPomMembers();
    const { buildToolOptions } = await import("../../goal-loop/application");
    const offered = buildToolOptions({ page, reach: geometryReach }).find(
      ({ key }) => key === "Node.open"
    )!.tool.args[0]!.closedSet;
    expect(offered).toMatchObject({
      kind: "instance",
      roots: [{}, {}],
    });
    const ref = await rootRef("TreePage.node.child");
    await session.ayme.tools.run("Node.open", { ref }, { by: callers.webmcp });
    expect(called).toEqual(["inner"]);
    document.querySelector("#inner")!.remove();
    await probeRegisteredPomMembers();
    expect(
      session.ayme.tools.list().some(({ name }) => name === "Node.open")
    ).toBe(true);
    document.querySelector("#outer")!.remove();
    await probeRegisteredPomMembers();
    expect(
      session.ayme.tools.list().some(({ name }) => name === "Node.open")
    ).toBe(false);
  } finally {
    session.stop();
  }
});

it("uses a class instance from a later registration when the first has none", async () => {
  document.body.innerHTML = '<button id="later">Later</button>';
  const page = createPage();
  const session = startSession(page);
  const called = vi.fn();
  class First {
    items = [];
  }
  class Second {
    items = [rooted(page.locator("#later"), { open: called })];
  }
  const manifest = (className: string): PomManifest => ({
    className,
    tools: [],
    members: [
      {
        memberName: "items",
        kind: "component",
        access: "field",
        componentClassName: "LaterItem",
        collection: true,
      },
    ],
    components: [
      {
        className: "LaterItem",
        tools: [
          { methodName: "open", toolName: "LaterItem.open", parameters: [] },
        ],
        members: [],
      },
    ],
  });
  registerCompiledPom(First, manifest("First"));
  registerCompiledPom(Second, manifest("Second"));
  try {
    session.register(First);
    session.register(Second);
    await probeRegisteredPomMembers();
    expect(
      session.ayme.tools.list().find(({ name }) => name === "LaterItem.open")
        ?.inputSchema.required
    ).toContain("ref");
    await session.ayme.tools.run(
      "LaterItem.open",
      { ref: await rootRef("Second.items[0]") },
      { by: callers.webmcp }
    );
    expect(called).toHaveBeenCalledOnce();
  } finally {
    session.stop();
  }
});

it("keeps each live version's actions while shared classes remount after HMR", async () => {
  document.body.innerHTML =
    '<button id="old">Old</button><button id="new">New</button>';
  const page = createPage();
  const session = startSession(page);
  const removed = vi.fn();
  class HotItem extends RootedComponent {
    open() {}
  }
  const UpdatedItem = class HotItem extends RootedComponent {
    remove() {
      removed();
    }
  };
  const component = (methods: string[]): PomManifest => ({
    className: "HotItem",
    file: "src/HotItem.ts",
    tools: methods.map((methodName) => ({
      methodName,
      toolName: `HotItem.${methodName}`,
      parameters: [],
    })),
    members: [],
    components: [],
  });
  const original = component(["open"]);
  const updated = component(["remove"]);
  registerCompiledPom(HotItem, original);
  class FirstPage {
    item = new HotItem(page.locator("#old"));
  }
  class SecondPage {
    item = new UpdatedItem(page.locator("#new"));
  }
  const manifest = (className: string, item: PomManifest): PomManifest => ({
    className,
    tools: [],
    components: [item],
    members: [
      {
        memberName: "item",
        kind: "component",
        access: "field",
        componentClassName: "HotItem",
        collection: false,
      },
    ],
  });
  registerCompiledPom(FirstPage, manifest("FirstPage", original));
  registerCompiledPom(SecondPage, manifest("SecondPage", updated));
  try {
    session.register(FirstPage);
    await probeRegisteredPomMembers();
    registerCompiledPom(UpdatedItem, updated);
    session.register(SecondPage);
    await probeRegisteredPomMembers();
    expect(
      session.ayme.tools
        .list()
        .filter(({ group }) => group === "pageObject")
        .map(({ name }) => name)
    ).toEqual(["HotItem.open", "HotItem.remove"]);
    await session.ayme.tools.run(
      "HotItem.remove",
      { ref: await rootRef("SecondPage.item") },
      { by: callers.webmcp }
    );
    expect(removed).toHaveBeenCalledOnce();
    session.unregister(SecondPage);
    expect(
      session.ayme.tools
        .list()
        .filter(({ group }) => group === "pageObject")
        .map(({ name }) => name)
    ).toEqual(["HotItem.open"]);
  } finally {
    session.stop();
  }
});
