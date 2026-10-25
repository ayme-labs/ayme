import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locator, Page } from "@playwright/test";

import {
  ayme as agent,
  runContext,
} from "../../test-utils/agentCalls.testSupport";
import type { PomManifest, ToolManifest } from "../../shared";
import { ayme } from "../domain/decorators";
import { createPage } from "./browserPage";
import {
  listAvailablePomTools,
  listRegisteredPoms,
  probeRegisteredPomMembers,
  registerCompiledPom,
} from "./registry";
import { createAyme, type Ayme } from "../../runtime";

// Observation and publication seam (ADR-0042): a Page Object Model that
// names its root on the decorator, observed on a real page, and what the
// session's tool list and the page state say about it.

const action = (methodName: string, toolName: string): ToolManifest => ({
  methodName,
  toolName,
  description: methodName,
  parameters: [],
});
const locator = (memberName: string) =>
  ({ memberName, kind: "locator", access: "field" }) as const;
const pageManifest = (
  className: string,
  members: PomManifest["members"] = []
): PomManifest => ({
  className,
  members,
  tools: [action("open", `${className}.open`)],
  components: [],
});

describe("Page Object Root by option", () => {
  let page: Page;
  let session: Ayme;
  let stopSession: () => void;
  const names = () =>
    session.tools
      .list()
      .filter((tool) => tool.group === "pageObject")
      .map((tool) => tool.name);
  const listed = (name: string) =>
    session.tools.list().find((tool) => tool.name === name);
  const observedMembers = () =>
    listRegisteredPoms().flatMap((registration) =>
      registration.memberObservations.map(
        (observation) => observation.memberName
      )
    );
  beforeEach(() => {
    document.body.innerHTML = "";
    page = createPage();
    session = createAyme({ pageFactory: () => page });
    stopSession = session.start();
  });
  afterEach(() => {
    stopSession();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("anchors a model at the element its root option names: present while it is on the page, labelled by it, and measured at it", async () => {
    document.body.innerHTML =
      '<aside id="drawer" style="width:200px;height:100px">Menu <button>Close</button></aside>';
    class SideDrawer {
      container = page.locator("#drawer");
      closeButton = page.getByRole("button", { name: "Close" });
      open() {}
    }
    ayme({ root: (self: SideDrawer) => self.container })(SideDrawer);
    registerCompiledPom(
      SideDrawer,
      pageManifest("SideDrawer", [locator("container"), locator("closeButton")])
    );
    session.pom.register(SideDrawer);
    await probeRegisteredPomMembers();
    expect(listed("SideDrawer.open")).toMatchObject({ available: true });
    expect((await agent.getPageState()).text).toMatch(/e\d+ SideDrawer\b/);
    // The anchor is the root, not a child; the other members are listed.
    expect(observedMembers()).toEqual(["closeButton"]);

    const element = document.getElementById("drawer")!;
    element.style.display = "none";
    await probeRegisteredPomMembers();
    expect(names()).toEqual([]);
    expect((await agent.getPageState()).text).not.toContain("SideDrawer");

    element.style.display = "";
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div id="overlay" style="position:fixed;inset:0;z-index:10"></div>'
    );
    await probeRegisteredPomMembers();
    expect(listed("SideDrawer.open")).toMatchObject({
      available: false,
      reason: "a click would not reach it",
    });
    expect((await agent.getPageState()).text).toContain("SideDrawer");
  });

  it("takes a collection item's ref and label from the element its root option names, and leaves the anchoring getter out of its children", async () => {
    document.body.innerHTML =
      '<ul><li id="draft">Draft <button>Send</button></li><li id="sent">Sent <button>Send</button></li></ul>';
    class Item {
      sent = false;
      constructor(private readonly row: Locator) {}
      // A fresh Locator on each read: still the root, by its element.
      get element() {
        return this.row;
      }
      get sendButton() {
        return this.row.getByRole("button");
      }
      send() {
        this.sent = true;
      }
    }
    ayme({ root: (self: Item) => self.element })(Item);
    class Outbox {
      items = [
        new Item(page.locator("#draft")),
        new Item(page.locator("#sent")),
      ];
    }
    registerCompiledPom(Outbox, {
      className: "Outbox",
      members: [
        {
          memberName: "items",
          kind: "component",
          access: "field",
          componentClassName: "Item",
          collection: true,
        },
      ],
      tools: [],
      components: [
        {
          className: "Item",
          members: [
            { memberName: "element", kind: "locator", access: "getter" },
            { memberName: "sendButton", kind: "locator", access: "getter" },
          ],
          tools: [action("send", "Outbox.items.send")],
        },
      ],
    });
    const outbox = session.pom.register(Outbox);
    await probeRegisteredPomMembers();
    expect(listed("Outbox.items.send")).toMatchObject({ available: true });
    expect(observedMembers()).toEqual([
      "items",
      "items[0].root",
      "items[0].sendButton",
      "items[1].root",
      "items[1].sendButton",
    ]);
    const { text } = await agent.getPageState();
    const refOf = (index: number) =>
      text.match(new RegExp(`(e\\d+) Outbox\\.items\\[${index}\\]`))?.[1];
    const sent = refOf(1);
    if (!refOf(0) || !sent) throw new Error("Expected refs for both items.");
    await session.tools.run("Outbox.items.send", { ref: sent });
    expect(outbox.items.map((item) => item.sent)).toEqual([false, true]);
  });

  it("inherits the root through a base class, and a subclass overrides present alone or root alone", async () => {
    document.body.innerHTML =
      '<div id="shell"><nav id="menu">Menu</nav><aside id="drawer">Drawer</aside><div id="panel">Panel</div></div>';
    abstract class AppComponent {
      constructor(readonly container: Locator) {}
      open() {}
    }
    const rootOf = (self: AppComponent) => self.container;
    ayme({ root: rootOf })(AppComponent);
    // Undecorated: the base's root.
    class Menu extends AppComponent {}
    // Its own presence, the base's root.
    class Drawer extends AppComponent {
      expanded = false;
    }
    ayme({ present: (self: Drawer) => self.expanded })(Drawer);
    // Its own root, the base's lack of a predicate.
    class Panel extends AppComponent {
      constructor(readonly frame: Locator) {
        super(page.locator("#nowhere"));
      }
    }
    ayme({ root: (self: Panel) => self.frame })(Panel);
    class Shell {
      menu = new Menu(page.locator("#menu"));
      drawer = new Drawer(page.locator("#drawer"));
      panel = new Panel(page.locator("#panel"));
    }
    const child = (memberName: string, componentClassName: string) =>
      ({
        memberName,
        kind: "component",
        access: "field",
        componentClassName,
        collection: false,
      }) as const;
    const component = (className: string) => ({
      className,
      members: [locator("container")],
      tools: [action("open", `Shell.${className.toLowerCase()}.open`)],
    });
    registerCompiledPom(Shell, {
      className: "Shell",
      members: [
        child("menu", "Menu"),
        child("drawer", "Drawer"),
        child("panel", "Panel"),
      ],
      tools: [],
      components: [component("Menu"), component("Drawer"), component("Panel")],
    });
    const shell = session.pom.register(Shell);
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Shell.menu.open", "Shell.panel.open"]);
    const { text } = await agent.getPageState();
    expect(text).toMatch(/e\d+ Shell\.menu\b/);
    expect(text).toMatch(/e\d+ Shell\.panel\b/);
    expect(text).not.toContain("Shell.drawer");

    shell.drawer.expanded = true;
    await probeRegisteredPomMembers();
    expect(names()).toEqual([
      "Shell.menu.open",
      "Shell.drawer.open",
      "Shell.panel.open",
    ]);
  });

  it("measures a call's reach at the root the observation found, and runs no root predicate with the call", async () => {
    document.body.innerHTML =
      '<aside id="drawer" style="width:200px;height:100px">Menu</aside>';
    class SideDrawer {
      container = page.locator("#drawer");
      opened = 0;
      open() {
        this.opened += 1;
      }
    }
    let anchor = page.locator("#drawer");
    ayme({ root: () => anchor })(SideDrawer);
    registerCompiledPom(
      SideDrawer,
      pageManifest("SideDrawer", [locator("container")])
    );
    const drawer = session.pom.register(SideDrawer);
    await probeRegisteredPomMembers();
    const tool = listAvailablePomTools().find(
      ({ name }) => name === "SideDrawer.open"
    );
    if (!tool) throw new Error("Expected SideDrawer.open to be available.");
    await tool.execute({}, runContext());
    expect(drawer.opened).toBe(1);

    document.body.insertAdjacentHTML(
      "beforeend",
      '<div id="overlay" style="position:fixed;inset:0;z-index:10"></div>'
    );
    await probeRegisteredPomMembers();
    // A predicate asked now would name no element, so a call that asked it
    // would run unmeasured: the call measures at the root the observation
    // found, under the overlay.
    anchor = page.locator("#nowhere");
    await expect(tool.execute({}, runContext())).rejects.toThrow(
      "SideDrawer.open is unavailable: a click would not reach it."
    );
    expect(drawer.opened).toBe(1);

    // The root the observation found left the page: no call runs on it.
    document.getElementById("drawer")!.remove();
    await expect(tool.execute({}, runContext())).rejects.toThrow(
      "SideDrawer.open is unavailable: its Page Object is not on the page."
    );
    expect(drawer.opened).toBe(1);
  });

  it("anchors a model with both at the element its option names, not at its member named root", async () => {
    document.body.innerHTML =
      '<main id="page">Page</main><aside id="drawer">Menu</aside>';
    class SideDrawer {
      root = page.locator("#page");
      container = page.locator("#drawer");
      open() {}
    }
    ayme({ root: (self: SideDrawer) => self.container })(SideDrawer);
    registerCompiledPom(
      SideDrawer,
      pageManifest("SideDrawer", [locator("root"), locator("container")])
    );
    session.pom.register(SideDrawer);
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["SideDrawer.open"]);
    expect((await agent.getPageState()).text).toContain("SideDrawer: Menu");
    expect(observedMembers()).toEqual(["root"]);

    document.getElementById("drawer")!.remove();
    await probeRegisteredPomMembers();
    expect(names()).toEqual([]);
  });

  it("treats a model with a member named root and no option as root-less: tools listed while registered, no label, no reach measurement", async () => {
    document.body.innerHTML =
      '<aside id="drawer" style="width:200px;height:100px">Menu</aside>' +
      '<div id="overlay" style="position:fixed;inset:0;z-index:10"></div>';
    class SideDrawer {
      root = page.locator("#drawer");
      open() {}
    }
    registerCompiledPom(
      SideDrawer,
      pageManifest("SideDrawer", [locator("root")])
    );
    session.pom.register(SideDrawer);
    await probeRegisteredPomMembers();
    // The name anchors nothing: the element under the overlay is not a root
    // a click must reach, and the page state does not label it.
    expect(listed("SideDrawer.open")).toEqual(
      expect.objectContaining({ available: true })
    );
    expect(listed("SideDrawer.open")).not.toHaveProperty("reason");
    expect((await agent.getPageState()).text).not.toContain("SideDrawer");
    // The member named root is an ordinary member.
    expect(observedMembers()).toEqual(["root"]);

    document.getElementById("drawer")!.remove();
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["SideDrawer.open"]);

    session.pom.unregister(SideDrawer);
    await probeRegisteredPomMembers();
    expect(names()).toEqual([]);
  });

  /** A shell rooted at `#shell` with one single child, `panel`, of `Panel`. */
  const shellWithPanel = <T extends object>(
    Panel: new () => T,
    panelMembers: PomManifest["members"] = []
  ) => {
    class Shell {
      container = page.locator("#shell");
      panel = new Panel();
    }
    ayme({ root: (self: Shell) => self.container })(Shell);
    registerCompiledPom(Shell, {
      className: "Shell",
      members: [
        locator("container"),
        {
          memberName: "panel",
          kind: "component",
          access: "field",
          componentClassName: "Panel",
          collection: false,
        },
      ],
      tools: [],
      components: [
        {
          className: "Panel",
          members: panelMembers,
          tools: [action("close", "Shell.panel.close")],
        },
      ],
    });
    return Shell;
  };

  it("lists a root-less single child's tools while the Page Object it is reached through is present, with no label and no reach measurement, and withdraws them with it", async () => {
    document.body.innerHTML =
      '<section id="shell" style="width:200px;height:100px"><div id="panel">Panel</div></section>' +
      '<div id="overlay" style="position:fixed;inset:0;z-index:10"></div>';
    class Panel {
      closed = false;
      root = page.locator("#panel");
      close() {
        this.closed = true;
      }
    }
    const Shell = shellWithPanel(Panel, [locator("root")]);
    const shell = session.pom.register(Shell);
    await probeRegisteredPomMembers();
    // The shell's root is under the overlay; the child has no root to
    // measure at, so its tool is available, and its member named root is an
    // ordinary member.
    expect(listed("Shell.panel.close")).toEqual(
      expect.objectContaining({ available: true })
    );
    expect(listed("Shell.panel.close")).not.toHaveProperty("reason");
    expect((await agent.getPageState()).text).not.toContain("Shell.panel");
    expect(listRegisteredPoms()[0]!.memberObservations).toEqual([
      { memberName: "panel.root", kind: "locator", access: "field", count: 1 },
    ]);
    await session.tools.run("Shell.panel.close", {});
    expect(shell.panel.closed).toBe(true);

    document.getElementById("shell")!.remove();
    await probeRegisteredPomMembers();
    expect(names()).toEqual([]);
  });

  it("judges a root-less single child with a predicate by it alone, also while the Page Object it is reached through is absent by its root", async () => {
    document.body.innerHTML = "<p>No shell</p>";
    class Panel {
      expanded = true;
      close() {}
    }
    ayme({ present: (self: Panel) => self.expanded })(Panel);
    const shell = session.pom.register(shellWithPanel(Panel));
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Shell.panel.close"]);

    shell.panel.expanded = false;
    await probeRegisteredPomMembers();
    expect(names()).toEqual([]);
  });

  it("refuses a root-less collection item at registration, also with a member named root", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    class Item {
      root = page.locator("li");
      open() {}
    }
    class Outbox {
      items: Item[] = [];
    }
    const item = pageManifest("Item", [locator("root")]);
    registerCompiledPom(Item, item);
    registerCompiledPom(Outbox, {
      ...pageManifest("Outbox"),
      tools: [],
      members: [
        {
          memberName: "items",
          kind: "component",
          access: "field",
          componentClassName: "Item",
          collection: true,
        },
      ],
      components: [item],
    });
    session.pom.register(Outbox);
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message:
          'The Page Object class "Item" declares no root and is reached from more than one place: Outbox.items[].',
      })
    );
    await probeRegisteredPomMembers();
    expect(names()).toEqual([]);
    await probeRegisteredPomMembers();
    expect(logged).toHaveBeenCalledOnce();
  });

  it("records what a child's root predicate threw, logs it once, and withdraws the child's tools", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML =
      '<section id="shell"><div id="panel">Panel</div></section>';
    class Panel {
      close() {}
    }
    ayme({
      root: () => {
        throw new TypeError("frame is undefined");
      },
    })(Panel);
    class Shell {
      panel = new Panel();
    }
    registerCompiledPom(Shell, {
      className: "Shell",
      members: [
        {
          memberName: "panel",
          kind: "component",
          access: "field",
          componentClassName: "Panel",
          collection: false,
        },
      ],
      tools: [],
      components: [
        {
          className: "Panel",
          members: [],
          tools: [action("close", "Shell.panel.close")],
        },
      ],
    });
    session.pom.register(Shell);
    await probeRegisteredPomMembers();
    expect(names()).toEqual([]);
    expect(listRegisteredPoms()[0]!.memberObservations).toEqual([
      {
        memberName: "panel.root",
        kind: "component-root",
        count: 0,
        error:
          "POM component panel's root could not be read: TypeError: frame is undefined.",
      },
    ]);
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      'The Page Object "Shell.panel" is absent: its root predicate threw TypeError: frame is undefined.'
    );

    document.body.innerHTML = "<p>Changed</p>";
    await probeRegisteredPomMembers();
    expect(logged).toHaveBeenCalledOnce();
  });

  it("logs that a child's root matches several elements once, again when the count changes, and not while it matches none", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML =
      '<section id="shell"><button>Rename</button><button>Rename</button></section>';
    class Panel {
      close() {}
    }
    ayme({ root: () => page.getByRole("button", { name: "Rename" }) })(Panel);
    session.pom.register(shellWithPanel(Panel));
    await probeRegisteredPomMembers();
    expect(names()).toEqual([]);
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      'The Page Object "Shell.panel" is absent: its root matches 2 elements.'
    );

    await probeRegisteredPomMembers();
    expect(logged).toHaveBeenCalledOnce();

    const shell = document.getElementById("shell")!;
    shell.insertAdjacentHTML("beforeend", "<button>Rename</button>");
    await probeRegisteredPomMembers();
    expect(logged).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenLastCalledWith(
      'The Page Object "Shell.panel" is absent: its root matches 3 elements.'
    );

    shell.replaceChildren();
    await probeRegisteredPomMembers();
    expect(names()).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(2);
  });

  it("logs that a Page Object's own root matches several elements, once", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = "<aside>One</aside><aside>Two</aside>";
    class Drawer {
      open() {}
    }
    ayme({ root: () => page.locator("aside") })(Drawer);
    registerCompiledPom(Drawer, pageManifest("Drawer"));
    session.pom.register(Drawer);
    await probeRegisteredPomMembers();
    expect(names()).toEqual([]);
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      'The Page Object "Drawer" is absent: its root matches 2 elements.'
    );

    await probeRegisteredPomMembers();
    expect(logged).toHaveBeenCalledOnce();
  });

  it("refuses a root-less child of a collection item while keeping its rooted parent's tools", async () => {
    document.body.innerHTML = "<ul><li>First</li></ul>";
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    class Toolbar {
      open() {}
    }
    class Row {
      container = page.locator("li");
      toolbar = new Toolbar();
      open() {}
    }
    ayme({ root: (self: Row) => self.container })(Row);
    class Table {
      rows = [new Row()];
    }
    const toolbar = pageManifest("Toolbar");
    const row = pageManifest("Row", [
      {
        memberName: "toolbar",
        kind: "component",
        access: "field",
        componentClassName: "Toolbar",
        collection: false,
      },
    ]);
    registerCompiledPom(Toolbar, toolbar);
    registerCompiledPom(Row, { ...row, components: [toolbar] });
    registerCompiledPom(Table, {
      ...pageManifest("Table"),
      tools: [],
      members: [
        {
          memberName: "rows",
          kind: "component",
          access: "field",
          componentClassName: "Row",
          collection: true,
        },
      ],
      components: [row, toolbar],
    });
    session.pom.register(Table);
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message:
          'The Page Object class "Toolbar" declares no root and is reached from more than one place: Table.rows[].toolbar.',
      })
    );
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Table.rows.open"]);
  });

  it("lets a collection tool act on a nested instance of its class, labelled at its full depth, without adding tools", async () => {
    document.body.innerHTML = `
      <ul>
        <li id="src">src
          <ul><li id="lib">lib<ul><li id="util">util.ts</li></ul></li></ul>
        </li>
      </ul>
    `;
    const expanded: string[] = [];
    class TreeItem {
      readonly container: Locator;
      constructor(
        readonly id: string,
        readonly children: TreeItem[] = []
      ) {
        this.container = page.locator(`#${id}`);
      }
      expand() {
        expanded.push(this.id);
      }
    }
    ayme({ root: (self: TreeItem) => self.container })(TreeItem);
    class FileTree {
      items = [
        new TreeItem("src", [new TreeItem("lib", [new TreeItem("util")])]),
      ];
    }
    registerCompiledPom(FileTree, {
      className: "FileTree",
      members: [
        {
          memberName: "items",
          kind: "component",
          access: "field",
          componentClassName: "TreeItem",
          collection: true,
        },
      ],
      tools: [],
      components: [
        {
          className: "TreeItem",
          members: [
            locator("container"),
            {
              memberName: "children",
              kind: "component",
              access: "field",
              componentClassName: "TreeItem",
              collection: true,
            },
          ],
          tools: [action("expand", "FileTree.items.expand")],
        },
      ],
    });
    session.pom.register(FileTree);
    await probeRegisteredPomMembers();

    expect(names()).toEqual(["FileTree.items.expand"]);
    const { text } = await agent.getPageState();
    const util = text.match(
      /(e\d+) FileTree\.items\[0\]\.children\[0\]\.children\[0\]/
    )?.[1];
    if (!util) throw new Error("Expected a ref for the deepest item.");
    const tool = listAvailablePomTools().find(
      ({ name }) => name === "FileTree.items.expand"
    );
    if (!tool)
      throw new Error("Expected FileTree.items.expand to be available.");

    await tool.execute({ ref: util, args: {} }, runContext());

    expect(expanded).toEqual(["util"]);
  });
});
