import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPage } from "./browserPage";
import ayme from "./index";
import {
  createAymeRuntime,
  createPageRegistration,
  listRegisteredPomRoots,
  listRegisteredPomTools,
  listRegisteredPoms,
  probeRegisteredPomMembers,
  registerCompiledPom,
} from "./registry";
import { synchronizeWebMcpTools } from "./webMcp";
import type {
  PomComponentMemberManifest,
  PomManifest,
  ToolManifest,
} from "./contracts";

const action = (methodName: string, toolName = methodName): ToolManifest => ({
  methodName,
  toolName,
  description: methodName,
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
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
      tools: [action("close")],
    },
  ],
});
const names = () => listRegisteredPomTools().map((tool) => tool.name);

describe("live Page Object availability", () => {
  let page: ReturnType<typeof createPage>;
  let runtime: ReturnType<typeof createAymeRuntime>;
  beforeEach(() => {
    document.body.innerHTML = "";
    page = createPage();
    runtime = createAymeRuntime(page);
  });
  afterEach(() => {
    runtime.dispose();
    document.body.innerHTML = "";
  });

  it("distinguishes absent roots from present but obstructed roots", async () => {
    document.body.innerHTML =
      '<aside id="sidebar" style="display:none;width:240px;height:120px">Sidebar</aside>';
    class Shell {
      sidebar = { root: page.locator("#sidebar"), close() {} };
      open() {}
    }
    registerCompiledPom(
      Shell,
      manifest("Shell", [child("sidebar")], [action("open", "Shell.open")])
    );
    createPageRegistration(Shell);
    const sidebar = document.getElementById("sidebar")!;
    let clicks = 0;
    sidebar.addEventListener("click", () => clicks++);

    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Shell.open"]);
    expect((await ayme.getPageState()).text).not.toContain("Shell.sidebar");

    sidebar.setAttribute("style", "width:240px;height:120px");
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Shell.open", "Shell.sidebar.close"]);
    expect((await ayme.getPageState()).text).toContain("Shell.sidebar");

    document.body.insertAdjacentHTML(
      "beforeend",
      '<div id="overlay" style="position:fixed;inset:0;z-index:10"></div>'
    );
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Shell.open"]);
    expect((await ayme.getPageState()).text).toContain("Shell.sidebar");

    document.getElementById("overlay")!.remove();
    sidebar.setAttribute(
      "style",
      "position:fixed;left:0;top:0;width:240px;height:120px;transform:translateX(-100%)"
    );
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Shell.open"]);
    expect((await ayme.getPageState()).text).not.toContain("Shell.sidebar");

    sidebar.setAttribute("style", "width:240px;height:120px");
    await probeRegisteredPomMembers();
    expect(names()).toContain("Shell.sidebar.close");
    expect((await ayme.getPageState()).text).toContain("Shell.sidebar");
    sidebar.remove();
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Shell.open"]);
    expect((await ayme.getPageState()).text).not.toContain("Shell.sidebar");
    expect(listRegisteredPoms()[0]?.manifest.components[0]?.tools).toHaveLength(
      1
    );
    expect(clicks).toBe(0);
  });

  it("refreshes direct page-state capture without publication", async () => {
    document.body.innerHTML = '<aside id="sidebar">Sidebar</aside>';
    class Shell {
      sidebar = { root: page.locator("#sidebar"), close() {} };
    }
    registerCompiledPom(Shell, manifest("Shell", [child("sidebar")]));
    createPageRegistration(Shell);
    expect((await ayme.getPageState()).text).toContain("Shell.sidebar");
    document.getElementById("sidebar")!.style.visibility = "hidden";
    expect((await ayme.getPageState()).text).not.toContain("Shell.sidebar");
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
    registerCompiledPom(
      Sidebar,
      manifest("Sidebar", [root()], [action("open", "Sidebar.open")])
    );
    createPageRegistration(Sidebar);

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
    createPageRegistration(Rooted);
    createPageRegistration(Rootless);
    expect(names()).toEqual(["Rootless.open"]);
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Rooted.close", "Rootless.open"]);
    expect((await listRegisteredPomRoots()).map((root) => root.label)).toEqual([
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
      panels = ["first", "second"].map((id) => ({
        root: page.locator(`#${id}`),
        close() {},
      }));
    }
    registerCompiledPom(Shell, manifest("Shell", [child("panels", true)]));
    createPageRegistration(Shell);
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Shell.panels.close"]);
    expect((await listRegisteredPomRoots()).map((root) => root.label)).toEqual([
      "Shell.panels[1]",
    ]);
    document.getElementById("second")!.setAttribute("hidden", "");
    await probeRegisteredPomMembers();
    expect(names()).toEqual([]);
    expect(await listRegisteredPomRoots()).toEqual([]);
  });

  it("keeps same-class registrations independent", async () => {
    document.body.innerHTML =
      '<section id="first" hidden>First</section><section id="second">Second</section>';
    class Shared {
      root = page.locator("#first");
      close() {}
    }
    registerCompiledPom(
      Shared,
      manifest("Shared", [root()], [action("close", "Shared.close")])
    );
    const first = createPageRegistration(Shared);
    const second = createPageRegistration(Shared);
    second.instance.root = page.locator("#second");
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Shared.close"]);
    expect(
      (await listRegisteredPomRoots()).map((root) => root.element.id)
    ).toEqual(["second"]);
    second.dispose();
    expect(names()).toEqual([]);
    first.dispose();
  });

  it("updates publication after layout events without a DOM mutation", async () => {
    document.body.innerHTML =
      '<style id="availability-style">#sidebar { visibility: visible; }</style><aside id="sidebar">Sidebar</aside>';
    class Shell {
      sidebar = { root: page.locator("#sidebar"), close() {} };
    }
    registerCompiledPom(Shell, manifest("Shell", [child("sidebar")]));
    createPageRegistration(Shell);
    const published = new Map<string, unknown>();
    const publication = await synchronizeWebMcpTools({
      async registerTool(
        tool: { name: string },
        options?: { signal?: AbortSignal }
      ) {
        published.set(tool.name, tool);
        options?.signal?.addEventListener("abort", () => {
          if (published.get(tool.name) === tool) published.delete(tool.name);
        });
      },
    });
    try {
      await expect
        .poll(() => [...published.keys()])
        .toEqual(["get_page_state", "Shell.sidebar.close"]);
      const rule = document.querySelector<HTMLStyleElement>(
        "#availability-style"
      )!.sheet!.cssRules[0] as CSSStyleRule;
      rule.style.visibility = "hidden";
      expect(
        getComputedStyle(document.getElementById("sidebar")!).visibility
      ).toBe("hidden");
      window.dispatchEvent(new Event("resize"));
      await expect
        .poll(() => [...published.keys()])
        .toEqual(["get_page_state"]);
      rule.style.visibility = "visible";
      window.dispatchEvent(new Event("transitionend"));
      await expect
        .poll(() => [...published.keys()])
        .toEqual(["get_page_state", "Shell.sidebar.close"]);
    } finally {
      publication.dispose();
    }
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
        return [{ root: page.locator("#root"), close() {} }];
      }
    }
    registerCompiledPom(
      Shell,
      manifest("Shell", [{ ...child("panels", true), access: "method" }])
    );
    const registration = createPageRegistration(Shell);
    const probe = probeRegisteredPomMembers();
    await Promise.resolve();
    registration.dispose();
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
        return [{ root: page.locator("#root"), close() {} }];
      }
    }
    registerCompiledPom(
      SlowShell,
      manifest("SlowShell", [{ ...child("panels", true), access: "method" }])
    );
    createPageRegistration(SlowShell);
    const previousProbe = probeRegisteredPomMembers();
    await entered;
    runtime.dispose();
    runtime = createAymeRuntime(page);
    class FreshShell {
      root = page.locator("#root");
      close() {}
    }
    registerCompiledPom(
      FreshShell,
      manifest("FreshShell", [root()], [action("close", "FreshShell.close")])
    );
    createPageRegistration(FreshShell);
    try {
      await expect.poll(names).toEqual(["FreshShell.close"]);
    } finally {
      release();
      await previousProbe;
    }
    expect(names()).toEqual(["FreshShell.close"]);
    expect((await listRegisteredPomRoots()).map((root) => root.label)).toEqual([
      "FreshShell",
    ]);
  });
  it("omits an off-canvas subtree and its refs, then restores it when opened", async () => {
    document.body.innerHTML =
      '<aside id="sidebar" style="width:240px;height:120px">SIDEBAR CONTENT <button>Sidebar action</button></aside><main>MAIN CONTENT</main>';
    class Shell {
      sidebar = { root: page.locator("#sidebar"), close() {} };
    }
    registerCompiledPom(Shell, manifest("Shell", [child("sidebar")]));
    createPageRegistration(Shell);
    const before = await ayme.getPageState();
    const ref = before.text.match(/(e\d+|s_\w+) Shell\.sidebar/)?.[1];
    expect(ref).toBeDefined();
    const sidebar = document.getElementById("sidebar")!;
    sidebar.style.cssText =
      "position:fixed;left:0;top:0;width:240px;height:120px;transform:translateX(-100%)";
    const hidden = await ayme.getPageState();
    expect(hidden.text).not.toContain("SIDEBAR CONTENT");
    expect(hidden.text).not.toContain("Sidebar action");
    expect(hidden.text).not.toContain("Shell.sidebar");
    expect(hidden.text).toContain("MAIN CONTENT");
    expect(names()).toEqual([]);
    expect((await before.resolve(ref!))[0]?.status).toBe("unresolved");
    sidebar.style.transform = "none";
    const restored = await ayme.getPageState();
    expect(restored.text).toContain("SIDEBAR CONTENT");
    expect(restored.text).toContain("Shell.sidebar");
    expect(names()).toEqual(["Shell.sidebar.close"]);
  });

  it("keeps modal-blocked content and POM labels while removing only its tools", async () => {
    document.body.innerHTML =
      '<section id="background">BACKGROUND CONTENT <button>Background action</button></section><dialog id="first"><button>Active confirmation</button></dialog><dialog id="second"><button>Earlier dialog</button></dialog>';
    class Shell {
      background = { root: page.locator("#background"), close() {} };
      first = { root: page.locator("#first"), close() {} };
      second = { root: page.locator("#second"), close() {} };
    }
    registerCompiledPom(
      Shell,
      manifest("Shell", [child("background"), child("first"), child("second")])
    );
    createPageRegistration(Shell);
    document.querySelector<HTMLDialogElement>("#second")!.showModal();
    document.querySelector<HTMLDialogElement>("#first")!.showModal();
    const state = await ayme.getPageState();
    for (const content of [
      "BACKGROUND CONTENT",
      "Background action",
      "Shell.background",
      "Shell.first",
      "Shell.second",
    ])
      expect(state.text).toContain(content);
    expect(names()).toEqual(["Shell.first.close"]);
    document.querySelector<HTMLDialogElement>("#first")!.close();
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Shell.second.close"]);
    document.querySelector<HTMLDialogElement>("#second")!.close();
    await probeRegisteredPomMembers();
    expect(names()).toEqual(["Shell.background.close"]);
  });

  it("excludes fully clipped POM content from the structural tree", async () => {
    document.body.innerHTML =
      '<section id="root" style="position:fixed;left:0;top:0;width:200px;height:100px;clip-path:inset(100%)">CLIPPED CONTENT <button>Clipped action</button></section><main>MAIN CONTENT</main>';
    class Clipped {
      root = page.locator("#root");
      close() {}
    }
    registerCompiledPom(
      Clipped,
      manifest("Clipped", [root()], [action("close", "Clipped.close")])
    );
    createPageRegistration(Clipped);
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
    registerCompiledPom(
      Clipped,
      manifest("Clipped", [root()], [action("close", "Clipped.close")])
    );
    createPageRegistration(Clipped);
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
        return [{ root: page.locator("#root"), close() {} }];
      }
    }
    registerCompiledPom(
      SlowShell,
      manifest("SlowShell", [{ ...child("panels", true), access: "method" }])
    );
    createPageRegistration(SlowShell);
    let ticks = 0;
    const ticker = document.getElementById("ticker")!;
    const timer = setInterval(() => {
      ticker.textContent = String(++ticks);
    }, 5);
    const published: string[] = [];
    let completed = false;
    const result = Promise.all([
      synchronizeWebMcpTools({
        async registerTool(tool: { name: string }) {
          published.push(tool.name);
        },
      }),
      ayme.getPageState(),
    ]).then((value) => {
      completed = true;
      return value;
    });
    try {
      await expect.poll(() => completed).toBe(true);
      const [, state] = await result;
      expect(ticks).toBeGreaterThan(0);
      expect(state.text).toContain("SlowShell.panels[0]");
      expect(published).toEqual(["get_page_state", "SlowShell.panels.close"]);
    } finally {
      clearInterval(timer);
      (await result)[0].dispose();
    }
  });

  it("retains scroll-reachable content, labels and tools without scrolling", async () => {
    document.body.innerHTML =
      '<div style="height:2000px"></div><section id="root">BELOW FOLD CONTENT</section>';
    class BelowFold {
      root = page.locator("#root");
      close() {}
    }
    registerCompiledPom(
      BelowFold,
      manifest("BelowFold", [root()], [action("close", "BelowFold.close")])
    );
    createPageRegistration(BelowFold);
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
      dialog = { root: page.locator("#modal"), close() {} };
    }
    registerCompiledPom(Shell, manifest("Shell", [child("dialog")]));
    createPageRegistration(Shell);
    document.querySelector<HTMLDialogElement>("#modal")!.showModal();
    const state = await ayme.getPageState();
    expect(state.text).toContain("Shell.dialog");
    expect(state.text).toContain("Confirm");
    expect(names()).toEqual(["Shell.dialog.close"]);
  });
});
