import { AriaRefSchema } from "@ayme-dev/core/structural-observation";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPage } from "./browserPage";
import { ayme } from "../../test-utils/agentCalls.testSupport";
import { ayme as model } from "../domain/decorators";
import { rootOf, rooted } from "../../test-utils/pomRoot.testSupport";
import {
  listRegisteredPomRoots,
  listAvailablePomTools,
  listRegisteredPoms,
  probeRegisteredPomMembers,
  registerCompiledPom,
} from "./registry";
import type {
  PomComponentMemberManifest,
  PomManifest,
  ToolManifest,
} from "../../shared";
import {
  startSession,
  type TestSession,
} from "../../test-utils/session.testSupport";

const action = (methodName: string, toolName = methodName): ToolManifest => ({
  methodName: methodName.split(".").at(-1)!,
  toolName,
  description: methodName,
  parameters: [],
});
const child = (
  memberName: string,
  collection = false
): PomComponentMemberManifest => ({
  memberName,
  collection,
  kind: "component",
  access: "field",
  componentClassName: "Panel",
});
const root = () =>
  ({ memberName: "root", kind: "locator", access: "field" }) as const;
const manifest = (
  className: string,
  members: PomManifest["members"],
  tools: ToolManifest[] = []
): PomManifest => ({
  className,
  members,
  tools,
  components: [
    {
      className: "Panel",
      members: [{ memberName: "root", kind: "locator", access: "field" }],
      tools: [action("Panel.close")],
    },
  ],
});
const names = () => listAvailablePomTools().map((tool) => tool.name);

describe("live Page Object availability", () => {
  let page: ReturnType<typeof createPage>;
  let session: TestSession;
  beforeEach(() => {
    document.body.innerHTML = "";
    page = createPage();
    session = startSession(page);
  });
  afterEach(() => {
    session.stop();
    document.body.innerHTML = "";
  });

  it("distinguishes absent roots from present but obstructed roots", async () => {
    document.body.innerHTML =
      '<aside id="sidebar" style="display:none;width:240px;height:120px">Sidebar</aside>';
    class Shell {
      sidebar = rooted(page.locator("#sidebar"), { close() {} });
      open() {}
    }
    registerCompiledPom(
      Shell,
      manifest("Shell", [child("sidebar")], [action("open", "Shell.open")])
    );
    session.register(Shell);
    const sidebar = document.getElementById("sidebar")!;
    let clicks = 0;
    sidebar.addEventListener("click", () => clicks++);

    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Shell.open"]);
    expect((await ayme.getPageState()).text).not.toContain("Panel");

    sidebar.setAttribute("style", "width:240px;height:120px");
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Shell.open", "Panel.close"]);
    expect((await ayme.getPageState()).text).toContain("Panel");

    document.body.insertAdjacentHTML(
      "beforeend",
      '<div id="overlay" style="position:fixed;inset:0;z-index:10"></div>'
    );
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Shell.open"]);
    expect((await ayme.getPageState()).text).toContain("Panel");

    document.getElementById("overlay")!.remove();
    sidebar.setAttribute(
      "style",
      "position:fixed;left:0;top:0;width:240px;height:120px;transform:translateX(-100%)"
    );
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Shell.open"]);
    expect((await ayme.getPageState()).text).not.toContain("Panel");

    sidebar.setAttribute("style", "width:240px;height:120px");
    await probeRegisteredPomMembers();
    expect(names()).toContain("Panel.close");
    expect((await ayme.getPageState()).text).toContain("Panel");
    sidebar.remove();
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Shell.open"]);
    expect((await ayme.getPageState()).text).not.toContain("Panel");
    expect(listRegisteredPoms()[0]?.manifest.components[0]?.tools).toHaveLength(
      1
    );
    expect(clicks).toBe(0);
  });

  it("refreshes direct page-state capture without publication", async () => {
    document.body.innerHTML = '<aside id="sidebar">Sidebar</aside>';
    class Shell {
      sidebar = rooted(page.locator("#sidebar"), { close() {} });
    }
    registerCompiledPom(Shell, manifest("Shell", [child("sidebar")]));
    session.register(Shell);
    expect((await ayme.getPageState()).text).toContain("Panel");
    document.getElementById("sidebar")!.style.visibility = "hidden";
    expect((await ayme.getPageState()).text).not.toContain("Panel");
    expect(names()).toEqual([]);
  });

  it("omits a zero-width sidebar shell with an off-canvas panel", async () => {
    document.body.style.cssText =
      "display:flex;min-height:100vh;width:100%;position:relative";
    document.body.innerHTML = `
      <div id="sidebar" data-state="collapsed" data-collapsible="offcanvas">
        <div style="position:relative;width:0"></div>
        <div style="position:absolute;inset-block:0;left:-256px;width:256px;display:flex">
          <button>Hidden profile</button>
        </div>
      </div>
      <main style="flex:1">Main content</main>
    `;
    class Sidebar {
      root = page.locator("#sidebar");
      open() {}
    }
    model({ root: rootOf })(Sidebar);
    registerCompiledPom(
      Sidebar,
      manifest("Sidebar", [root()], [action("open", "Sidebar.open")])
    );
    session.register(Sidebar);

    const state = await ayme.getPageState();
    expect(state.text).not.toContain("Hidden profile");
    expect(state.text).not.toContain("Sidebar");
    expect(state.text).toContain("Main content");
    expect(names()).toEqual([]);
  });

  it("gates rooted page actions and preserves rootless actions", async () => {
    document.body.innerHTML = '<section id="root">Page</section>';
    class Rooted {
      root = page.locator("#root");
      close() {}
    }
    model({ root: rootOf })(Rooted);
    class Rootless {
      open() {}
    }
    registerCompiledPom(
      Rooted,
      manifest(
        "Rooted",
        [{ memberName: "root", kind: "locator", access: "field" }],
        [action("close", "Rooted.close")]
      )
    );
    registerCompiledPom(
      Rootless,
      manifest("Rootless", [], [action("open", "Rootless.open")])
    );
    session.register(Rooted);
    session.register(Rootless);
    // Neither lists a tool before the first observation has run.
    expect(names()).toEqual([]);
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Rooted.close", "Rootless.open"]);
    expect((await listRegisteredPomRoots()).map((root) => root.mark)).toEqual([
      "Rooted",
    ]);
    document.getElementById("root")!.style.display = "none";
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Rootless.open"]);
  });

  it("keeps collection indices and publishes a shared tool only for available instances", async () => {
    document.body.innerHTML =
      '<section id="first" hidden>First</section><section id="second">Second</section>';
    class Shell {
      panels = ["first", "second"].map((id) =>
        rooted(page.locator(`#${id}`), {
          close() {},
        })
      );
    }
    registerCompiledPom(Shell, manifest("Shell", [child("panels", true)]));
    session.register(Shell);
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Panel.close"]);
    expect((await listRegisteredPomRoots()).map((root) => root.mark)).toEqual([
      "Panel",
    ]);
    document.getElementById("second")!.setAttribute("hidden", "");
    await probeRegisteredPomMembers();
    expect(names()).toEqual([]);
    expect(await listRegisteredPomRoots()).toEqual([]);
  });

  it("updates availability after layout events without a DOM mutation", async () => {
    document.body.innerHTML =
      '<style id="availability-style">#sidebar { visibility: visible; }</style><aside id="sidebar">Sidebar</aside>';
    class Shell {
      sidebar = rooted(page.locator("#sidebar"), { close() {} });
    }
    registerCompiledPom(Shell, manifest("Shell", [child("sidebar")]));
    session.register(Shell);
    await expect.poll(names).toEqual(["Panel.close"]);
    const rule = document.querySelector<HTMLStyleElement>(
      "#availability-style"
    )!.sheet!.cssRules[0] as CSSStyleRule;
    rule.style.visibility = "hidden";
    expect(
      getComputedStyle(document.getElementById("sidebar")!).visibility
    ).toBe("hidden");
    window.dispatchEvent(new Event("resize"));
    await expect.poll(names).toEqual([]);
    rule.style.visibility = "visible";
    window.dispatchEvent(new Event("transitionend"));
    await expect.poll(names).toEqual(["Panel.close"]);
  });

  it("does not publish a disposed registration after its async observation completes", async () => {
    document.body.innerHTML = '<section id="root">Panel</section>';
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    class Shell {
      async panels() {
        await pending;
        return [rooted(page.locator("#root"), { close() {} })];
      }
    }
    registerCompiledPom(
      Shell,
      manifest("Shell", [{ ...child("panels", true), access: "method" }])
    );
    session.register(Shell);
    const probe = probeRegisteredPomMembers();
    await Promise.resolve();
    session.unregister(Shell);
    release();
    await probe;
    expect(names()).toEqual([]);
    expect(await listRegisteredPomRoots()).toEqual([]);
  });

  it("lets a new runtime observe while a disposed runtime still has a pending member", async () => {
    document.body.innerHTML = '<section id="root">Panel</section>';
    let release!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    class SlowShell {
      async panels() {
        started();
        await pending;
        return [rooted(page.locator("#root"), { close() {} })];
      }
    }
    registerCompiledPom(
      SlowShell,
      manifest("SlowShell", [{ ...child("panels", true), access: "method" }])
    );
    session.register(SlowShell);
    const previousProbe = probeRegisteredPomMembers();
    await entered;
    session.stop();
    session = startSession(page);
    class FreshShell {
      root = page.locator("#root");
      close() {}
    }
    model({ root: rootOf })(FreshShell);
    registerCompiledPom(
      FreshShell,
      manifest("FreshShell", [root()], [action("close", "FreshShell.close")])
    );
    session.register(FreshShell);
    try {
      await expect.poll(names).toEqual(["FreshShell.close"]);
    } finally {
      release();
      await previousProbe;
    }
    expect(names()).toEqual(["FreshShell.close"]);
    expect((await listRegisteredPomRoots()).map((root) => root.mark)).toEqual([
      "FreshShell",
    ]);
  });
  it("omits an off-canvas subtree and its refs, then restores it when opened", async () => {
    document.body.innerHTML =
      '<aside id="sidebar" style="width:240px;height:120px">SIDEBAR CONTENT <button>Sidebar action</button></aside><main>MAIN CONTENT</main>';
    class Shell {
      sidebar = rooted(page.locator("#sidebar"), { close() {} });
    }
    registerCompiledPom(Shell, manifest("Shell", [child("sidebar")]));
    session.register(Shell);
    const before = await ayme.getPageState();
    const ref = before.text.match(/(e\d+|s_\w+) Panel/)?.[1];
    expect(ref).toBeDefined();
    const sidebar = document.getElementById("sidebar")!;
    sidebar.style.cssText =
      "position:fixed;left:0;top:0;width:240px;height:120px;transform:translateX(-100%)";
    const hidden = await ayme.getPageState();
    expect(hidden.text).not.toContain("SIDEBAR CONTENT");
    expect(hidden.text).not.toContain("Sidebar action");
    expect(hidden.text).not.toContain("Panel");
    expect(hidden.text).toContain("MAIN CONTENT");
    expect(names()).toEqual([]);
    expect((await before.resolve(AriaRefSchema.parse(ref!)))[0]?.status).toBe(
      "unresolved"
    );
    sidebar.style.transform = "none";
    const restored = await ayme.getPageState();
    expect(restored.text).toContain("SIDEBAR CONTENT");
    expect(restored.text).toContain("Panel");
    expect(names()).toEqual(["Panel.close"]);
  });

  it("keeps modal-blocked content and Page Object Root Marks while removing only its tools", async () => {
    document.body.innerHTML =
      '<section id="background">BACKGROUND CONTENT <button>Background action</button></section><dialog id="first"><button>Active confirmation</button></dialog><dialog id="second"><button>Earlier dialog</button></dialog>';
    class Shell {
      background = rooted(page.locator("#background"), { close() {} });
      first = rooted(page.locator("#first"), { close() {} });
      second = rooted(page.locator("#second"), { close() {} });
    }
    registerCompiledPom(
      Shell,
      manifest("Shell", [child("background"), child("first"), child("second")])
    );
    session.register(Shell);
    document.querySelector<HTMLDialogElement>("#second")!.showModal();
    document.querySelector<HTMLDialogElement>("#first")!.showModal();
    const state = await ayme.getPageState();
    for (const content of ["BACKGROUND CONTENT", "Background action", "Panel"])
      expect(state.text).toContain(content);
    expect(names()).toEqual(["Panel.close"]);
    document.querySelector<HTMLDialogElement>("#first")!.close();
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Panel.close"]);
    document.querySelector<HTMLDialogElement>("#second")!.close();
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Panel.close"]);
  });

  it("excludes fully clipped POM content from the structural tree", async () => {
    document.body.innerHTML =
      '<section id="root" style="position:fixed;left:0;top:0;width:200px;height:100px;clip-path:inset(100%)">CLIPPED CONTENT <button>Clipped action</button></section><main>MAIN CONTENT</main>';
    class Clipped {
      root = page.locator("#root");
      close() {}
    }
    model({ root: rootOf })(Clipped);
    registerCompiledPom(
      Clipped,
      manifest("Clipped", [root()], [action("close", "Clipped.close")])
    );
    session.register(Clipped);
    const state = await ayme.getPageState();
    expect(state.text).not.toContain("CLIPPED CONTENT");
    expect(state.text).not.toContain("Clipped action");
    expect(state.text).toContain("MAIN CONTENT");
    expect(names()).toEqual([]);
  });

  it("excludes circle-clipped POM content and tools", async () => {
    document.body.innerHTML =
      '<section id="root" style="clip-path:circle(0)">CLIPPED CONTENT</section><main>MAIN CONTENT</main>';
    class Clipped {
      root = page.locator("#root");
      close() {}
    }
    model({ root: rootOf })(Clipped);
    registerCompiledPom(
      Clipped,
      manifest("Clipped", [root()], [action("close", "Clipped.close")])
    );
    session.register(Clipped);
    const state = await ayme.getPageState();
    expect(state.text).not.toContain("CLIPPED CONTENT");
    expect(state.text).toContain("MAIN CONTENT");
    expect(names()).toEqual([]);
  });

  it("captures and publishes while unrelated content keeps changing", async () => {
    document.body.innerHTML =
      '<section id="root">Panel</section><span id="ticker"></span>';
    class SlowShell {
      async panels() {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return [rooted(page.locator("#root"), { close() {} })];
      }
    }
    registerCompiledPom(
      SlowShell,
      manifest("SlowShell", [{ ...child("panels", true), access: "method" }])
    );
    session.register(SlowShell);
    let ticks = 0;
    const ticker = document.getElementById("ticker")!;
    const timer = setInterval(() => {
      ticker.textContent = String(++ticks);
    }, 5);
    let completed = false;
    const result = Promise.all([
      probeRegisteredPomMembers(),
      ayme.getPageState(),
    ]).then((value) => {
      completed = true;
      return value;
    });
    try {
      await expect.poll(() => completed).toBe(true);
      const [, state] = await result;
      expect(ticks).toBeGreaterThan(0);
      expect(state.text).toContain("Panel");
      expect(names()).toEqual(["Panel.close"]);
    } finally {
      clearInterval(timer);
    }
  });

  it("retains scroll-reachable content, marks and tools without scrolling", async () => {
    document.body.innerHTML =
      '<div style="height:2000px"></div><section id="root">BELOW FOLD CONTENT</section>';
    class BelowFold {
      root = page.locator("#root");
      close() {}
    }
    model({ root: rootOf })(BelowFold);
    registerCompiledPom(
      BelowFold,
      manifest("BelowFold", [root()], [action("close", "BelowFold.close")])
    );
    session.register(BelowFold);
    const scroll = [window.scrollX, window.scrollY];
    const state = await ayme.getPageState();
    expect(state.text).toContain("BELOW FOLD CONTENT");
    expect(state.text).toContain("BelowFold");
    expect(names()).toEqual(["BelowFold.close"]);
    expect([window.scrollX, window.scrollY]).toEqual(scroll);
  });
  it("retains a present modal inside a non-present POM wrapper", async () => {
    document.body.innerHTML =
      '<div id="wrapper" inert><dialog id="modal"><button>Confirm</button></dialog></div>';
    class Shell {
      root = page.locator("#wrapper");
      dialog = rooted(page.locator("#modal"), { close() {} });
    }
    model({ root: rootOf })(Shell);
    registerCompiledPom(Shell, manifest("Shell", [child("dialog")]));
    session.register(Shell);
    document.querySelector<HTMLDialogElement>("#modal")!.showModal();
    const state = await ayme.getPageState();
    expect(state.text).toContain("Panel");
    expect(state.text).toContain("Confirm");
    expect(names()).toEqual(["Panel.close"]);
  });
});
