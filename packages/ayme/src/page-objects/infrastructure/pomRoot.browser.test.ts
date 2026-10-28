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
import { geometryReach } from "../../page-state/infrastructure";

// Observation and publication seam (ADR-0042): a Page Object Model that
// names its root on the decorator, observed on a real page, and what the
// session's tool list and the page state say about it.

const action = (methodName: string, toolName: string): ToolManifest => ({
  methodName: methodName.split(".").at(-1)!,
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

  it("requires each rooted page and single child's own ref, and offers both as Goal Loop items", async () => {
    document.body.innerHTML =
      '<main id="shell"><button id="child">Open</button></main>';
    const opened: string[] = [];
    class Child {
      root = page.locator("#child");
      open() {
        opened.push("child");
      }
    }
    ayme({ root: (self: Child) => self.root })(Child);
    const childManifest = pageManifest("Child", [locator("root")]);
    registerCompiledPom(Child, childManifest);
    class Shell {
      root = page.locator("#shell");
      child = new Child();
      open() {
        opened.push("shell");
      }
    }
    ayme({ root: (self: Shell) => self.root })(Shell);
    registerCompiledPom(Shell, {
      ...pageManifest("Shell", [
        locator("root"),
        {
          memberName: "child",
          kind: "component",
          access: "field",
          componentClassName: "Child",
          collection: false,
        },
      ]),
      components: [childManifest],
    });
    session.pom.register(Shell);
    await probeRegisteredPomMembers();
    for (const name of ["Shell.open", "Child.open"])
      expect(listed(name)?.inputSchema).toMatchObject({
        required: expect.arrayContaining(["ref"]),
        properties: { ref: { type: "string" } },
      });
    const state = await agent.getPageState();
    const shellRef = state.text.match(/(\w+) Shell\b/)![1]!;
    const childRef = state.text.match(/(\w+) Child\b/)![1]!;
    const { buildToolOptions } = await import("../../goal-loop/application");
    const options = buildToolOptions({ page, reach: geometryReach });
    for (const name of ["Shell.open", "Child.open"])
      expect(
        options.find(({ key }) => key === name)?.tool.args[0]?.closedSet
      ).toMatchObject({
        kind: "instance",
        roots: [
          expect.objectContaining({
            available: true,
          }),
        ],
      });
    await session.tools.run("Shell.open", { ref: shellRef }, { by: "webmcp" });
    await session.tools.run("Child.open", { ref: childRef }, { by: "webmcp" });
    await expect(
      session.tools.run("Child.open", { ref: shellRef }, { by: "webmcp" })
    ).rejects.toThrow(`ref "${shellRef}": it is not a root of Child`);
    expect(opened).toEqual(["shell", "child"]);
  });

  it("takes direct arguments and offers no instances for a root-less class", async () => {
    document.body.innerHTML = "<output></output>";
    class Announcer {
      announce(text: string) {
        document.querySelector("output")!.textContent = text;
      }
    }
    ayme(Announcer);
    registerCompiledPom(Announcer, {
      className: "Announcer",
      members: [],
      components: [],
      tools: [
        {
          ...action("announce", "Announcer.announce"),
          parameters: [
            { name: "text", optional: false, schema: { type: "string" } },
          ],
        },
      ],
    });
    session.pom.register(Announcer);
    await probeRegisteredPomMembers();
    expect(listed("Announcer.announce")?.inputSchema).toMatchObject({
      properties: { text: { type: "string" } },
      required: ["text"],
    });
    expect(
      listed("Announcer.announce")?.inputSchema.properties
    ).not.toHaveProperty("ref");
    const { buildToolOptions } = await import("../../goal-loop/application");
    const offered = buildToolOptions({ page, reach: geometryReach }).find(
      ({ key }) => key === "Announcer.announce"
    )!;
    expect(offered.tool.args).toMatchObject([
      { name: "text", closedSet: null },
    ]);
    await session.tools.run(
      "Announcer.announce",
      { text: "Hello" },
      { by: "webmcp" }
    );
    expect(document.querySelector("output")?.textContent).toBe("Hello");
  });

  it("runs a rooted instance inside an open shadow root by its own ref", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML =
      '<section aria-label="Panel"><button>Open</button></section>';
    class ShadowPanel {
      root = page.getByRole("region", { name: "Panel" });
      open() {
        shadow.querySelector("button")!.textContent = "Opened";
      }
    }
    ayme({ root: (self: ShadowPanel) => self.root })(ShadowPanel);
    registerCompiledPom(
      ShadowPanel,
      pageManifest("ShadowPanel", [locator("root")])
    );
    session.pom.register(ShadowPanel);
    await probeRegisteredPomMembers();
    const ref = (await agent.getPageState()).text.match(
      /(e\d+) region "Panel"/
    )?.[1];
    expect(ref).toBeDefined();
    await session.tools.run("ShadowPanel.open", { ref }, { by: "webmcp" });
    expect(shadow.querySelector("button")?.textContent).toBe("Opened");
  });

  it("offers only present connected roots and calls an instance after a withdrawn one", async () => {
    document.body.innerHTML =
      '<ul><li id="withdrawn">Withdrawn</li><li id="first">First</li><li id="second">Second</li><li id="hidden" hidden>Hidden</li></ul>';
    const opened: string[] = [];
    class Row {
      constructor(readonly id: string) {}
      get root() {
        return page.locator(`#${this.id}`);
      }
      open() {
        opened.push(this.id);
      }
    }
    ayme({
      root: (self: Row) => self.root,
      present: (self: Row) => self.id !== "withdrawn",
    })(Row);
    const rowManifest = pageManifest("Row", [locator("root")]);
    registerCompiledPom(Row, rowManifest);
    class RowsPage {
      rows = ["withdrawn", "first", "second", "hidden"].map(
        (id) => new Row(id)
      );
    }
    registerCompiledPom(RowsPage, {
      className: "RowsPage",
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
      components: [rowManifest],
    });
    session.pom.register(RowsPage);
    await probeRegisteredPomMembers();
    const { buildToolOptions } = await import("../../goal-loop/application");
    const offered = () =>
      buildToolOptions({ page, reach: geometryReach }).find(
        ({ key }) => key === "Row.open"
      )!.tool.args[0]!.closedSet;
    expect(offered()).toMatchObject({
      kind: "instance",
      roots: [{}, {}],
    });
    const state = await agent.getPageState();
    const ref = [...state.text.matchAll(/(e\d+) Row\b/g)][1]![1]!;
    await session.tools.run("Row.open", { ref }, { by: "webmcp" });
    expect(opened).toEqual(["second"]);
    document.getElementById("first")!.remove();
    // No probe follows the removal: the Goal Loop must leave out a stale root.
    expect(offered()).toMatchObject({
      kind: "instance",
      roots: [{}],
    });
  });

  it("refuses a ref when its instance's locator now holds another connected root", async () => {
    document.body.innerHTML =
      '<section id="panel" aria-label="Old">Old</section><section id="other" aria-label="New">New</section>';
    const open = vi.fn();
    class MovingPanel {
      root = page.locator("#panel");
      open = open;
    }
    ayme({ root: (self: MovingPanel) => self.root })(MovingPanel);
    registerCompiledPom(
      MovingPanel,
      pageManifest("MovingPanel", [locator("root")])
    );
    session.pom.register(MovingPanel);
    await probeRegisteredPomMembers();
    const ref = (await agent.getPageState()).text.match(
      /(e\d+) MovingPanel\b/
    )![1]!;
    document.getElementById("panel")!.id = "old";
    document.getElementById("other")!.id = "panel";
    await expect(
      session.tools.run("MovingPanel.open", { ref }, { by: "webmcp" })
    ).rejects.toThrow(`MovingPanel on ref "${ref}" is unavailable`);
    expect(open).not.toHaveBeenCalled();
  });

  it("anchors a model at the element its root option names: present while it is on the page, marked on it, and measured at it", async () => {
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

  it("takes a collection item's ref and mark from the element its root option names, and leaves the anchoring getter out of its children", async () => {
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
          tools: [action("Item.send", "Item.send")],
        },
      ],
    });
    const outbox = session.pom.register(Outbox);
    await probeRegisteredPomMembers();
    expect(listed("Item.send")).toMatchObject({ available: true });
    expect(observedMembers()).toEqual([
      "items",
      "items[0].root",
      "items[0].sendButton",
      "items[1].root",
      "items[1].sendButton",
    ]);
    const { text } = await agent.getPageState();
    const refOf = (index: number) =>
      [...text.matchAll(/(e\d+) Item\b/g)][index]?.[1];
    const sent = refOf(1);
    if (!refOf(0) || !sent) throw new Error("Expected refs for both items.");
    await session.tools.run("Item.send", { ref: sent });
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
      tools: [action("open", `${className}.open`)],
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
    expect(names()).toEqual(["Menu.open", "Panel.open"]);
    const { text } = await agent.getPageState();
    expect(text).toMatch(/e\d+ Menu\b/);
    expect(text).toMatch(/e\d+ Panel\b/);
    expect(text).not.toMatch(/(?:e\d+|s_\w+) Drawer\b/);

    shell.drawer.expanded = true;
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Menu.open", "Drawer.open", "Panel.open"]);
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
    const ref = (await agent.getPageState()).text.match(
      /(\w+) SideDrawer\b/
    )![1]!;
    await tool.execute({ ref }, runContext());
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
    await expect(tool.execute({ ref }, runContext())).rejects.toThrow(
      `SideDrawer on ref "${ref}" is unavailable: a click would not reach it.`
    );
    expect(drawer.opened).toBe(1);

    // The root the observation found left the page: no call runs on it.
    document.getElementById("drawer")!.remove();
    await expect(tool.execute({ ref }, runContext())).rejects.toThrow(
      `Cannot call SideDrawer.open on ref "${ref}": it is no longer on the page.`
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

  it("treats a model with a member named root and no option as root-less: tools listed while registered, no mark, no reach measurement", async () => {
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
    // a click must reach, and the page state does not mark it.
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
          tools: [action("Panel.close", "Panel.close")],
        },
      ],
    });
    return Shell;
  };

  it("lists a root-less single child's tools while the Page Object it is reached through is present, with no mark and no reach measurement, and withdraws them with it", async () => {
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
    expect(listed("Panel.close")).toEqual(
      expect.objectContaining({ available: true })
    );
    expect(listed("Panel.close")).not.toHaveProperty("reason");
    expect((await agent.getPageState()).text).not.toMatch(
      /(?:e\d+|s_\w+) Panel\b/
    );
    expect(listRegisteredPoms()[0]!.memberObservations).toEqual([
      { memberName: "panel.root", kind: "locator", access: "field", count: 1 },
    ]);
    await session.tools.run("Panel.close", {});
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
    expect(names()).toEqual(["Panel.close"]);

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
          'The Page Object class "Item" declares no root and has many instances below a collection: Outbox.items[] (below a collection).',
      })
    );
    await probeRegisteredPomMembers();
    expect(names()).toEqual([]);
    await probeRegisteredPomMembers();
    expect(logged).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "present",
      "Panel at Shell.panel: its present predicate threw TypeError: broken.",
    ],
    [
      "root",
      "Panel at Shell.panel: its root predicate threw TypeError: broken.",
    ],
    [
      "invalid root",
      "Panel at Shell.panel: its root is not a browser locator.",
    ],
    [
      "invalid locator",
      "Panel at Shell.panel: its link is not a browser locator.",
    ],
    ["non-object", "Panel at Shell.panel: it is not an object."],
  ] as const)(
    "names the class and path for %s diagnostics",
    async (fault, message) => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      class Panel {
        link = {};
        close() {}
      }
      if (fault === "present" || fault === "root")
        ayme({
          [fault]: () => {
            throw new TypeError("broken");
          },
        })(Panel);
      if (fault === "invalid root")
        ayme({ root: () => undefined as unknown as Locator })(Panel);
      const Shell = shellWithPanel(Panel, [locator("link")]);
      const shell = session.pom.register(Shell);
      if (fault === "non-object") shell.panel = null as unknown as Panel;
      await probeRegisteredPomMembers();
      expect(logged).toHaveBeenCalledExactlyOnceWith(message);
      await probeRegisteredPomMembers();
      expect(logged).toHaveBeenCalledOnce();
    }
  );

  it("keeps member read failures in the Inspector without logging them", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    class BrokenPage {
      get link() {
        throw new Error("getter failed");
      }
      child = {};
      open() {}
    }
    registerCompiledPom(BrokenPage, {
      ...pageManifest("BrokenPage", [
        locator("link"),
        {
          memberName: "child",
          kind: "component",
          access: "field",
          componentClassName: "Missing",
          collection: false,
        },
      ]),
    });
    session.pom.register(BrokenPage);
    await probeRegisteredPomMembers();
    expect(logged).not.toHaveBeenCalled();
    expect(listRegisteredPoms()[0]!.memberObservations).toMatchObject([
      { memberName: "link", error: "BrokenPage: getter failed" },
      {
        memberName: "child.root",
        error: "BrokenPage: No metadata found for component Missing.",
      },
    ]);
  });

  it("logs an invalid locator after an Inspector-only read failure with the same text", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    let failsOnRead = true;
    class BrokenPage {
      get link() {
        if (failsOnRead) throw new Error("its link is not a browser locator.");
        return {};
      }
      open() {}
    }
    registerCompiledPom(
      BrokenPage,
      pageManifest("BrokenPage", [locator("link")])
    );
    session.pom.register(BrokenPage);
    await probeRegisteredPomMembers();
    expect(logged).not.toHaveBeenCalled();
    failsOnRead = false;
    await probeRegisteredPomMembers();
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      "BrokenPage: its link is not a browser locator."
    );
    await probeRegisteredPomMembers();
    expect(logged).toHaveBeenCalledOnce();
  });

  it("reports a changed diagnostic and one that returns after recovery", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    let problem: string | undefined = "first";
    class Panel {
      close() {}
    }
    ayme({
      root: () => {
        if (problem) throw new Error(problem);
        return page.locator("#panel");
      },
    })(Panel);
    document.body.innerHTML =
      '<section id="shell"><div id="panel">Panel</div></section>';
    session.pom.register(shellWithPanel(Panel));
    await probeRegisteredPomMembers();
    expect(logged).toHaveBeenLastCalledWith(
      "Panel at Shell.panel: its root predicate threw first."
    );
    problem = "second";
    await probeRegisteredPomMembers();
    expect(logged).toHaveBeenLastCalledWith(
      "Panel at Shell.panel: its root predicate threw second."
    );
    problem = undefined;
    await probeRegisteredPomMembers();
    problem = "second";
    await probeRegisteredPomMembers();
    expect(logged).toHaveBeenCalledTimes(3);
  });

  it("reports an invalid page root at its class path, and still observes its children when the root throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = '<div id="panel">Panel</div>';
    class Panel {
      close() {}
    }
    ayme({ root: () => page.locator("#panel") })(Panel);
    const Shell = shellWithPanel(Panel);
    let throws = false;
    ayme({
      root: () => {
        if (throws) throw new Error("broken");
        return undefined as unknown as Locator;
      },
    })(Shell);
    session.pom.register(Shell);
    await probeRegisteredPomMembers();
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      "Shell: its root is not a browser locator."
    );
    expect(names()).toEqual(["Panel.close"]);
    expect(observedMembers()).toEqual(["root", "container", "panel.root"]);
    throws = true;
    await probeRegisteredPomMembers();
    expect(logged).toHaveBeenLastCalledWith(
      "Shell: its root predicate threw broken."
    );
    expect(names()).toEqual(["Panel.close"]);
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
          tools: [action("Panel.close", "Panel.close")],
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
        diagnostic: true,
        error:
          "Panel at Shell.panel: its root predicate threw TypeError: frame is undefined.",
      },
    ]);
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      "Panel at Shell.panel: its root predicate threw TypeError: frame is undefined."
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
      "Panel at Shell.panel: its root matches 2 elements."
    );

    await probeRegisteredPomMembers();
    expect(logged).toHaveBeenCalledOnce();

    const shell = document.getElementById("shell")!;
    shell.insertAdjacentHTML("beforeend", "<button>Rename</button>");
    await probeRegisteredPomMembers();
    expect(logged).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenLastCalledWith(
      "Panel at Shell.panel: its root matches 3 elements."
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
      "Drawer: its root matches 2 elements."
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
          'The Page Object class "Toolbar" declares no root and has many instances below a collection: Table.rows[].toolbar (below a collection).',
      })
    );
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Row.open"]);
  });

  it("lets a collection tool act on a nested instance of its class, marked by class at every depth, without adding tools", async () => {
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
          tools: [action("TreeItem.expand", "TreeItem.expand")],
        },
      ],
    });
    session.pom.register(FileTree);
    await probeRegisteredPomMembers();

    expect(names()).toEqual(["TreeItem.expand"]);
    const { text } = await agent.getPageState();
    const util = [...text.matchAll(/(e\d+) TreeItem\b/g)][2]?.[1];
    if (!util) throw new Error("Expected a ref for the deepest item.");
    const tool = listAvailablePomTools().find(
      ({ name }) => name === "TreeItem.expand"
    );
    if (!tool) throw new Error("Expected TreeItem.expand to be available.");

    await tool.execute({ ref: util, args: {} }, runContext());

    expect(expanded).toEqual(["util"]);
  });
});
