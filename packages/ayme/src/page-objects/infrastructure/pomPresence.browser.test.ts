import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locator, Page } from "@playwright/test";

import { ayme as agent } from "../../test-utils/agentCalls.testSupport";
import type { PomManifest, ToolManifest } from "../../shared";
import { ayme } from "../domain/decorators";
import { createPage } from "./browserPage";
import { rootOf } from "../../test-utils/pomRoot.testSupport";
import {
  listRegisteredPoms,
  probeRegisteredPomMembers,
  registerCompiledPom,
} from "./registry";
import { createAyme, type Ayme } from "../../runtime";

// Observation and publication seam (ADR-0042): a Page Object Model that
// declares when it is on the page, observed on a real page, and what the
// session's tool list and the page state say about it.

const action = (methodName: string, toolName: string): ToolManifest => ({
  methodName: methodName.split(".").at(-1)!,
  toolName,
  description: methodName,
  parameters: [],
});
const root = { memberName: "root", kind: "locator", access: "field" } as const;
const pageManifest = (
  className: string,
  members: PomManifest["members"] = []
): PomManifest => ({
  className,
  members,
  tools: [action("open", `${className}.open`)],
  components: [],
});

describe("Page Object Presence by predicate", () => {
  let page: Page;
  let session: Ayme;
  let stopSession: () => void;
  const names = () =>
    session.tools
      .list()
      .filter((tool) => tool.group === "pageObject")
      .map((tool) => tool.name);
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

  it.each([
    ["a synchronous", (self: { onPage: boolean }) => self.onPage],
    ["an asynchronous", async (self: { onPage: boolean }) => self.onPage],
  ])(
    "lists the tools of a model with %s present predicate only while it holds",
    async (_label, present) => {
      class SettingsPage {
        onPage = false;
        open() {}
      }
      ayme({ present })(SettingsPage);
      registerCompiledPom(SettingsPage, pageManifest("SettingsPage"));
      const settings = session.pom.register(SettingsPage);
      await probeRegisteredPomMembers();
      expect(names()).toEqual([]);

      settings.onPage = true;
      await probeRegisteredPomMembers();
      expect(names()).toEqual(["SettingsPage.open"]);

      settings.onPage = false;
      await probeRegisteredPomMembers();
      expect(names()).toEqual([]);
    }
  );

  it("makes a subclass present by the nearest class that declares a predicate", async () => {
    abstract class AppPage {
      onPage = false;
      open() {}
    }
    ayme({ present: (self: AppPage) => self.onPage })(AppPage);
    // Undecorated, and decorated without a predicate: both inherit the base's.
    class ProjectPage extends AppPage {}
    class SettingsPage extends AppPage {}
    ayme(SettingsPage);
    // Its own predicate wins over the base's, and its subclass inherits it.
    class HelpPage extends AppPage {}
    ayme({ present: () => true })(HelpPage);
    class FaqPage extends HelpPage {}
    for (const Model of [ProjectPage, SettingsPage, HelpPage, FaqPage]) {
      registerCompiledPom(Model, pageManifest(Model.name));
      session.pom.register(Model);
    }
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["HelpPage.open", "FaqPage.open"]);

    session.pom.get(ProjectPage).onPage = true;
    await probeRegisteredPomMembers();
    expect(names()).toEqual([
      "ProjectPage.open",
      "HelpPage.open",
      "FaqPage.open",
    ]);
  });

  it("lists a page present by its URL across history.pushState and back, without a DOM mutation", async () => {
    const firstEntry = navigation.currentEntry!;
    abstract class AppPage {
      abstract readonly path: string;
      constructor(readonly page: Page) {}
      open() {}
    }
    const onPage = (self: AppPage) =>
      new URLPattern({ pathname: self.path }).test(self.page.url());
    ayme({ present: onPage })(AppPage);
    class ProjectPage extends AppPage {
      readonly path = "/projects/:id";
    }
    registerCompiledPom(ProjectPage, pageManifest("ProjectPage"));
    session.pom.register(ProjectPage);
    await probeRegisteredPomMembers();
    expect(names()).toEqual([]);

    try {
      history.pushState({}, "", "/projects/7");
      await vi.waitFor(() => expect(names()).toEqual(["ProjectPage.open"]));
      history.replaceState({}, "", "/projects/7/settings");
      await vi.waitFor(() => expect(names()).toEqual([]));
      history.replaceState({}, "", "/projects/8");
      await vi.waitFor(() => expect(names()).toEqual(["ProjectPage.open"]));
      await navigation.traverseTo(firstEntry.key).finished;
      await vi.waitFor(() => expect(names()).toEqual([]));
    } finally {
      if (navigation.currentEntry!.key !== firstEntry.key)
        await navigation.traverseTo(firstEntry.key).finished;
    }
  });

  it("asks the predicate with the observation, never with a call, and reads no member of an absent model", async () => {
    document.body.innerHTML = '<ul id="items"><li>One</li></ul>';
    let reads = 0;
    class ListPage {
      onPage = false;
      opened = 0;
      get items() {
        reads += 1;
        return page.locator("#items li");
      }
      open() {
        this.opened += 1;
      }
    }
    const present = vi.fn((self: ListPage) => self.onPage);
    ayme({ present })(ListPage);
    registerCompiledPom(
      ListPage,
      pageManifest("ListPage", [
        { memberName: "items", kind: "locator", access: "getter" },
      ])
    );
    const list = session.pom.register(ListPage);
    await probeRegisteredPomMembers();
    expect(present).toHaveBeenCalledWith(list);
    expect(reads).toBe(0);

    list.onPage = true;
    await probeRegisteredPomMembers();
    expect(reads).toBe(1);
    expect(names()).toEqual(["ListPage.open"]);

    // The page did not change, so no observation ran between the predicate
    // changing its mind and the call: the call goes by the last observation.
    list.onPage = false;
    await session.tools.run("ListPage.open", {});
    expect(list.opened).toBe(1);
    await probeRegisteredPomMembers();
    expect(names()).toEqual([]);
    await expect(session.tools.run("ListPage.open", {})).rejects.toThrow(
      "ListPage.open is unavailable: its Page Object is not on the page."
    );
    expect(list.opened).toBe(1);
  });

  it.each(["present", "root"] as const)(
    "makes a model whose %s predicate throws absent, and logs the error once",
    async (option) => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      class ProjectPage {
        open() {}
      }
      ayme({
        [option]: () => {
          throw new TypeError("store is undefined");
        },
      })(ProjectPage);
      registerCompiledPom(ProjectPage, pageManifest("ProjectPage"));
      session.pom.register(ProjectPage);
      await probeRegisteredPomMembers();
      expect(names()).toEqual([]);
      expect(logged).toHaveBeenCalledExactlyOnceWith(
        `The Page Object "ProjectPage" is absent: its ${option} predicate threw TypeError: store is undefined.`
      );

      document.body.innerHTML = "<p>Changed</p>";
      await probeRegisteredPomMembers();
      expect(logged).toHaveBeenCalledOnce();
    }
  );

  it("needs the root on the page and the predicate to hold, and still measures availability at the root", async () => {
    document.body.innerHTML =
      '<aside id="drawer" style="width:200px;height:100px">Menu</aside>';
    class SideDrawer {
      root = page.locator("#drawer");
      isOpen = false;
      open() {}
    }
    ayme({ root: rootOf, present: (self: SideDrawer) => self.isOpen })(
      SideDrawer
    );
    registerCompiledPom(SideDrawer, pageManifest("SideDrawer", [root]));
    const drawer = session.pom.register(SideDrawer);
    const listed = () =>
      session.tools.list().find((tool) => tool.name === "SideDrawer.open");
    await probeRegisteredPomMembers();
    expect(names()).toEqual([]);
    expect((await agent.getPageState()).text).not.toContain("SideDrawer");

    drawer.isOpen = true;
    await probeRegisteredPomMembers();
    expect(listed()).toMatchObject({ available: true });
    expect((await agent.getPageState()).text).toContain("SideDrawer");

    const element = document.getElementById("drawer")!;
    element.style.display = "none";
    await probeRegisteredPomMembers();
    expect(names()).toEqual([]);

    element.style.display = "";
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div id="overlay" style="position:fixed;inset:0;z-index:10"></div>'
    );
    await probeRegisteredPomMembers();
    expect(listed()).toMatchObject({
      available: false,
      reason: "a click would not reach it",
    });
    expect((await agent.getPageState()).text).toContain("SideDrawer");
  });

  it("asks a child's predicate before its root, and reads no member of a child its predicate withdrew", async () => {
    document.body.innerHTML =
      '<section id="shell">Shell <div id="panel">Panel <button>Pin</button></div></section>';
    let reads = 0;
    class Pin {
      constructor(readonly root: Locator) {}
      press() {}
    }
    ayme({ root: rootOf })(Pin);
    class Panel {
      expanded = false;
      frame = page.locator("#panel");
      get pin() {
        reads += 1;
        return new Pin(this.frame.getByRole("button"));
      }
      close() {}
    }
    const frameOf = vi.fn((self: Panel) => self.frame);
    ayme({ root: frameOf, present: (self: Panel) => self.expanded })(Panel);
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
          members: [
            { memberName: "frame", kind: "locator", access: "field" },
            {
              memberName: "pin",
              kind: "component",
              access: "getter",
              componentClassName: "Pin",
              collection: false,
            },
          ],
          tools: [action("Panel.close", "Panel.close")],
        },
        {
          className: "Pin",
          members: [root],
          tools: [action("Pin.press", "Pin.press")],
        },
      ],
    });
    const shell = session.pom.register(Shell);
    await probeRegisteredPomMembers();
    // The absent panel costs its predicate alone: its root is not read, its
    // members are not walked, so its rooted child is not listed either.
    expect(names()).toEqual([]);
    expect(frameOf).not.toHaveBeenCalled();
    expect(reads).toBe(0);
    expect(listRegisteredPoms()[0]!.memberObservations).toEqual([]);

    shell.panel.expanded = true;
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Panel.close", "Pin.press"]);
    expect(frameOf).toHaveBeenCalledOnce();
    expect(reads).toBe(1);
  });
});
