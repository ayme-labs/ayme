import { afterEach, describe, expect, it } from "vitest";
import { geometryReach } from "../../page-state/infrastructure";
import { createPage } from "./browserPage";
import { observePomRoot as observe } from "./pomRootObservation";

import type { Locator } from "@playwright/test";

const byId = (id: string) => document.getElementById(id)!;

// What one observation found of the root, apart from its element.
const observePomRoot = async (locator: Locator) => {
  const { present, available, inTheWay } = (
    await observe(locator, geometryReach)
  ).root;
  return { present, available, inTheWay };
};

// Preserve the original availability matrix while testing presence separately.
const probePomReachability = async (locator: Locator) =>
  (await observePomRoot(locator)).available;

describe("POM root reachability", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
    document.documentElement.removeAttribute("style");
    window.scrollTo(0, 0);
  });

  it("recognizes visible informational and disabled roots without clicking", async () => {
    document.body.innerHTML =
      '<section id="root">Information</section><button disabled>Disabled</button>';
    const page = createPage();
    await expect(probePomReachability(page.locator("#root"))).resolves.toBe(
      true
    );
    await expect(probePomReachability(page.locator("button"))).resolves.toBe(
      true
    );
  });

  it.each([
    "display:none",
    "visibility:hidden",
    "width:0;height:0;overflow:hidden",
  ])("rejects a root with %s", async (style) => {
    document.body.innerHTML = `<div id="root" style="${style}">Hidden</div>`;
    await expect(
      probePomReachability(createPage().locator("#root"))
    ).resolves.toBe(false);
  });

  it("rejects missing and ambiguous roots", async () => {
    document.body.innerHTML =
      '<div class="root">One</div><div class="root">Two</div>';
    const page = createPage();
    await expect(probePomReachability(page.locator("#missing"))).resolves.toBe(
      false
    );
    await expect(probePomReachability(page.locator(".root"))).resolves.toBe(
      false
    );
  });

  it.each(["translateX(-100%)", "translateX(4000px)"])(
    "rejects an off-canvas fixed root with %s even on a scrollable document",
    async (transform) => {
      document.body.style.cssText = "width:8000px;height:8000px";
      document.body.innerHTML = `<aside id="root" style="position:fixed;left:0;top:0;width:240px;height:200px;transform:${transform}">Sidebar</aside>`;
      const root = createPage().locator("#root");
      expect(await root.isVisible()).toBe(true);
      await expect(probePomReachability(root)).resolves.toBe(false);
    }
  );

  it("accepts below-fold content without scrolling or focus changes", async () => {
    document.body.innerHTML =
      '<input id="focus" /><div style="height:2500px"></div><section id="root" style="height:100px">Below fold</section>';
    document.querySelector<HTMLInputElement>("#focus")!.focus();
    const before = {
      x: window.scrollX,
      y: window.scrollY,
      focus: document.activeElement,
    };
    const events: string[] = [];
    const record = (event: Event) => events.push(event.type);
    for (const type of ["scroll", "click", "pointerdown", "focusin"])
      window.addEventListener(type, record, true);
    try {
      const root = createPage().locator("#root");
      await expect(probePomReachability(root)).resolves.toBe(true);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect({
        x: window.scrollX,
        y: window.scrollY,
        focus: document.activeElement,
      }).toEqual(before);
      expect(events).toEqual([]);
    } finally {
      for (const type of ["scroll", "click", "pointerdown", "focusin"])
        window.removeEventListener(type, record, true);
    }
  });

  it("accepts a display-contents root through its rendered descendants", async () => {
    document.body.innerHTML =
      '<section id="root" style="display:contents"><button style="position:fixed;left:20px;top:20px;width:120px;height:80px">Save</button></section>';
    const root = createPage().locator("#root");
    expect(await root.isVisible()).toBe(true);

    await expect(observePomRoot(root)).resolves.toEqual({
      present: true,
      available: true,
      inTheWay: [],
    });
  });

  // The root renders no box; its fixed child escapes the clipping of the
  // root's own ancestors, so it is measured through its own.
  it("accepts a display-contents root whose fixed descendant escapes a clipping ancestor", async () => {
    document.body.innerHTML =
      '<div style="overflow:hidden;height:50px"><section id="root" style="display:contents"><button style="position:fixed;left:20px;top:200px;width:120px;height:40px">Save</button></section></div>';
    const root = createPage().locator("#root");
    expect(await root.isVisible()).toBe(true);

    await expect(observePomRoot(root)).resolves.toEqual({
      present: true,
      available: true,
      inTheWay: [],
    });
  });

  // The root renders no box of its own and has no element descendants; its
  // text is what shows, so the root is measured through that text.
  it("accepts a display-contents root whose only rendered content is text", async () => {
    document.body.innerHTML =
      '<section id="root" style="display:contents">Ready</section>';
    const root = createPage().locator("#root");
    expect(await root.isVisible()).toBe(true);

    await expect(observePomRoot(root)).resolves.toEqual({
      present: true,
      available: true,
      inTheWay: [],
    });
  });

  // Playwright Lite reads a box-less element's visibility from its light
  // children alone, so a root whose content is only in its shadow tree is not
  // visible to the click; Ayme agrees rather than offering what cannot be acted on.
  it("reads a display-contents root with only shadow content as absent, as the click does", async () => {
    document.body.innerHTML =
      '<section id="root" style="display:contents"></section>';
    const root = document.querySelector("#root")!;
    root.attachShadow({ mode: "open" }).innerHTML =
      '<button style="position:fixed;left:20px;top:20px;width:120px;height:80px">Save</button>';
    const locator = createPage().locator("#root");
    expect(await locator.isVisible()).toBe(false);

    await expect(observePomRoot(locator)).resolves.toEqual({
      present: false,
      available: false,
      inTheWay: [],
    });
  });

  // Positioning on a box-less element has no effect: its text stays in the
  // flow of the clipping ancestor, which clips it.
  it("reads a positioned display-contents root whose text is clipped away as absent", async () => {
    document.body.innerHTML =
      '<div style="overflow:hidden;height:10px"><div style="height:40px"></div><section id="root" style="display:contents;position:fixed">Ready</section></div>';

    await expect(
      observePomRoot(createPage().locator("#root"))
    ).resolves.toEqual({
      present: false,
      available: false,
      inTheWay: [],
    });
  });

  it("accepts nested scrolling without moving either scroll container", async () => {
    document.body.innerHTML =
      '<div id="outer" style="overflow:auto;width:300px;height:200px"><div style="height:600px"></div><div id="inner" style="overflow:auto;width:250px;height:150px"><div style="width:1200px;height:80px;display:flex;justify-content:flex-end"><section id="root" style="width:100px">Nested</section></div></div></div>';
    await expect(
      probePomReachability(createPage().locator("#root"))
    ).resolves.toBe(true);
    for (const id of ["outer", "inner"]) {
      const element = document.getElementById(id)!;
      expect([element.scrollLeft, element.scrollTop]).toEqual([0, 0]);
    }
  });

  it.each(["hidden", "clip"])(
    "rejects content clipped by overflow:%s",
    async (overflow) => {
      document.body.innerHTML = `<div style="overflow:${overflow};height:100px;width:200px"><div style="height:300px"></div><div id="root">Clipped</div></div>`;
      await expect(
        probePomReachability(createPage().locator("#root"))
      ).resolves.toBe(false);
    }
  );

  it("rejects content outside a scroll container's reachable range", async () => {
    document.body.innerHTML =
      '<div style="position:relative;overflow:auto;width:200px;height:100px"><div id="root" style="position:absolute;left:-300px;top:0;width:100px;height:50px">Unreachable</div><div style="width:1000px;height:1000px"></div></div>';
    await expect(
      probePomReachability(createPage().locator("#root"))
    ).resolves.toBe(false);
  });

  it("handles fixed roots inside transformed containing blocks", async () => {
    document.body.innerHTML =
      '<div style="height:2000px"></div><div style="transform:translateX(0);height:200px"><div id="root" style="position:fixed;top:0;left:0;width:100px;height:100px">Local fixed</div></div>';
    await expect(
      probePomReachability(createPage().locator("#root"))
    ).resolves.toBe(true);
  });

  it("rejects covered roots and restores them after the overlay disappears", async () => {
    document.body.innerHTML =
      '<section id="root" style="width:240px;height:200px">Sidebar</section><div id="overlay" style="position:fixed;inset:0;z-index:10"></div>';
    const root = createPage().locator("#root");
    await expect(probePomReachability(root)).resolves.toBe(false);
    document.getElementById("overlay")!.remove();
    await expect(probePomReachability(root)).resolves.toBe(true);
  });

  // A click lands at the centre of the part the viewport shows: a root bare
  // elsewhere is still out of reach there (ayme-labs/ayme#828).
  it("rejects a root covered only where a click would land, naming the cover", async () => {
    document.body.innerHTML =
      '<section id="root" style="position:fixed;left:0;top:0;width:200px;height:200px">Sidebar</section><div id="badge" style="position:fixed;left:80px;top:80px;width:40px;height:40px;z-index:10"></div>';
    await expect(
      observePomRoot(createPage().locator("#root"))
    ).resolves.toEqual({
      present: true,
      available: false,
      inTheWay: [byId("badge")],
    });
  });

  // Nothing shows of a below-fold root now, so there is no point to
  // hit-test: a call scrolls to it and tests it there (ADR-0041).
  it("accepts a below-fold root under a fullscreen overlay, which a call finds", async () => {
    document.body.innerHTML =
      '<div style="height:2000px"></div><section id="root" style="height:100px">Below fold</section><div style="position:fixed;inset:0;z-index:10"></div>';
    await expect(
      probePomReachability(createPage().locator("#root"))
    ).resolves.toBe(true);
  });

  it("accepts an offscreen root covered by a sibling that scrolls with it, which a call finds", async () => {
    document.body.innerHTML =
      '<div style="overflow:auto;height:200px;position:relative"><div style="height:500px"></div><div style="position:relative;height:100px"><section id="root" style="position:absolute;inset:0">Panel</section><div style="position:absolute;inset:0;z-index:10"></div></div></div>';
    await expect(
      probePomReachability(createPage().locator("#root"))
    ).resolves.toBe(true);
  });

  it("respects inert roots and modal blocking", async () => {
    document.body.innerHTML =
      '<section id="root">Outside</section><dialog><section id="inside">Inside</section></dialog>';
    const page = createPage();
    document.getElementById("root")!.setAttribute("inert", "");
    await expect(probePomReachability(page.locator("#root"))).resolves.toBe(
      false
    );
    document.getElementById("root")!.removeAttribute("inert");
    document.querySelector("dialog")!.showModal();
    await expect(probePomReachability(page.locator("#root"))).resolves.toBe(
      false
    );
    await expect(probePomReachability(page.locator("#inside"))).resolves.toBe(
      true
    );
  });

  it("treats an unsupported :modal selector as no modal", async () => {
    document.body.innerHTML = '<section id="root">Visible</section>';
    const original = Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function (
      this: Document,
      selectors: string
    ) {
      if (selectors === ":modal")
        throw new DOMException("Unsupported selector", "SyntaxError");
      return original.call(this, selectors);
    } as typeof Document.prototype.querySelectorAll;

    try {
      await expect(
        probePomReachability(createPage().locator("#root"))
      ).resolves.toBe(true);
    } finally {
      Document.prototype.querySelectorAll = original;
    }
  });

  it("observes roots and obstruction inside open shadow DOM", async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const shadow = document
      .getElementById("host")!
      .attachShadow({ mode: "open" });
    shadow.innerHTML =
      '<section id="root" style="height:100px">Shadow root</section><div id="overlay" style="position:fixed;inset:0;z-index:10"></div>';
    const root = createPage().locator("#root");
    await expect(probePomReachability(root)).resolves.toBe(false);
    shadow.getElementById("overlay")!.remove();
    await expect(probePomReachability(root)).resolves.toBe(true);
  });
  it("keeps an obstructed root structurally present", async () => {
    document.body.innerHTML =
      '<section id="root" style="width:200px;height:100px">Panel</section><div id="overlay" style="position:fixed;inset:0;z-index:10"></div>';
    await expect(
      observePomRoot(createPage().locator("#root"))
    ).resolves.toEqual({
      present: true,
      available: false,
      inTheWay: [byId("overlay")],
    });
  });

  it("uses modal opening order rather than DOM order", async () => {
    document.body.innerHTML =
      '<dialog id="first"><button id="active">Confirm</button></dialog><dialog id="second"><button id="blocked">Earlier dialog</button></dialog>';
    document.querySelector<HTMLDialogElement>("#second")!.showModal();
    document.querySelector<HTMLDialogElement>("#first")!.showModal();
    const page = createPage();
    await expect(observePomRoot(page.locator("#active"))).resolves.toEqual({
      present: true,
      available: true,
      inTheWay: [],
    });
    await expect(observePomRoot(page.locator("#blocked"))).resolves.toEqual({
      present: true,
      available: false,
      inTheWay: [byId("active"), byId("first")],
    });
    document.querySelector<HTMLDialogElement>("#first")!.close();
    await expect(observePomRoot(page.locator("#blocked"))).resolves.toEqual({
      present: true,
      available: true,
      inTheWay: [],
    });
  });

  it("lets a modal escape inherited inertness but respects inert inside it", async () => {
    document.body.innerHTML =
      '<div inert><dialog id="modal"><section id="panel"><button id="root">Confirm</button></section></dialog></div>';
    const modal = document.querySelector<HTMLDialogElement>("#modal")!;
    modal.showModal();
    const root = createPage().locator("#root");
    await expect(observePomRoot(root)).resolves.toEqual({
      present: true,
      available: true,
      inTheWay: [],
    });
    modal.inert = true;
    await expect(observePomRoot(root)).resolves.toEqual({
      present: true,
      available: false,
      inTheWay: [modal],
    });
    modal.inert = false;
    document.querySelector<HTMLElement>("#panel")!.inert = true;
    await expect(observePomRoot(root)).resolves.toEqual({
      present: true,
      available: false,
      inTheWay: [byId("panel")],
    });
  });

  it("rejects a fully clipped root even when HTML is hit", async () => {
    document.body.innerHTML =
      '<button id="root" style="position:fixed;left:20px;top:20px;width:120px;height:80px;clip-path:inset(100%)">Clipped</button>';
    const root = createPage().locator("#root");
    expect(await root.isVisible()).toBe(true);
    expect(document.elementFromPoint(40, 40)).not.toBe(
      document.getElementById("root")
    );
    await expect(observePomRoot(root)).resolves.toEqual({
      present: false,
      available: false,
      inTheWay: [],
    });
  });

  it("rejects a root clipped by circle(0)", async () => {
    document.body.innerHTML =
      '<button id="root" style="position:fixed;left:20px;top:20px;width:120px;height:80px;clip-path:circle(0)">Clipped</button>';
    await expect(
      observePomRoot(createPage().locator("#root"))
    ).resolves.toEqual({
      present: false,
      available: false,
      inTheWay: [],
    });
  });
});

describe("what is in the way of a present root a click would not reach", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
    document.documentElement.removeAttribute("style");
    window.scrollTo(0, 0);
  });

  const observeRoot = () => observePomRoot(createPage().locator("#root"));

  it("names the element over the root", async () => {
    document.body.innerHTML =
      '<section id="root" style="width:200px;height:100px">Content</section><div id="overlay" style="position:fixed;inset:0"></div>';

    expect((await observeRoot()).inTheWay).toEqual([byId("overlay")]);
  });

  it("names the last opened native modal the root is not in, over whatever covers it", async () => {
    document.body.innerHTML =
      '<section id="root" style="width:200px;height:100px">Content</section><dialog id="first"><button>First</button></dialog><dialog id="second"><button>Second</button></dialog>';
    document.querySelector<HTMLDialogElement>("#first")!.showModal();
    document.querySelector<HTMLDialogElement>("#second")!.showModal();

    expect(await observeRoot()).toEqual({
      present: true,
      available: false,
      inTheWay: [byId("second")],
    });
    expect((await observeRoot()).inTheWay).toEqual([byId("second")]);
  });

  it("names a modal it hits over a root in an earlier modal by itself, not what holds it", async () => {
    document.body.innerHTML =
      '<dialog id="lower"><section id="root" style="width:200px;height:100px">Content</section></dialog><div id="region"><dialog id="upper" style="width:100vw;height:100vh;max-width:none;max-height:none;padding:0;border:0"></dialog></div>';
    document.querySelector<HTMLDialogElement>("#lower")!.showModal();
    document.querySelector<HTMLDialogElement>("#upper")!.showModal();

    expect(await observeRoot()).toEqual({
      present: true,
      available: false,
      inTheWay: [byId("upper")],
    });
  });

  it("names nothing for a root inside the open modal", async () => {
    document.body.innerHTML =
      '<dialog id="modal"><section id="root" style="width:200px;height:100px">Content</section></dialog>';
    document.querySelector<HTMLDialogElement>("#modal")!.showModal();

    expect(await observeRoot()).toEqual({
      present: true,
      available: true,
      inTheWay: [],
    });
  });

  it("names what covers a root inside the open modal, not the modal", async () => {
    document.body.innerHTML =
      '<dialog id="modal" style="width:300px;height:200px"><section id="root" style="width:200px;height:100px">Content</section><div id="cover" style="position:absolute;inset:0"></div></dialog>';
    document.querySelector<HTMLDialogElement>("#modal")!.showModal();

    expect((await observeRoot()).inTheWay).toEqual([byId("cover")]);
  });

  it("names the inert ancestor", async () => {
    document.body.innerHTML =
      '<div id="wrapper" inert><section id="root" style="width:200px;height:100px">Content</section></div>';

    expect(await observeRoot()).toEqual({
      present: true,
      available: false,
      inTheWay: [byId("wrapper")],
    });
    expect((await observeRoot()).inTheWay).toEqual([byId("wrapper")]);
  });

  it("names the root's own ancestor when nothing else takes the click", async () => {
    document.body.style.pointerEvents = "none";
    document.body.innerHTML =
      '<section id="root" style="width:200px;height:100px">Content</section>';

    expect((await observeRoot()).inTheWay).toEqual([document.documentElement]);
  });

  it("names the covering element inside an open shadow root", async () => {
    document.body.innerHTML =
      '<section id="root" style="width:200px;height:100px">Content</section><div id="host"></div>';
    const shadow = byId("host").attachShadow({ mode: "open" });
    shadow.innerHTML =
      '<div id="cover" style="position:fixed;inset:0;background:white"></div>';

    // Walked up through the shadow root to the host, which does not hold the root.
    expect((await observeRoot()).inTheWay).toEqual([
      shadow.getElementById("cover"),
      byId("host"),
    ]);
  });

  it("names what covers the part of a root the viewport shows when its centre is out of view", async () => {
    document.documentElement.style.overflow = "hidden";
    const height = document.documentElement.clientHeight;
    document.body.innerHTML = `<section id="root" style="position:absolute;left:0;top:${height - 50}px;width:200px;height:200px">Content</section><div id="footer" style="position:fixed;left:0;right:0;bottom:0;height:60px"></div>`;

    expect(await observeRoot()).toEqual({
      present: true,
      available: false,
      inTheWay: [byId("footer")],
    });
    expect((await observeRoot()).inTheWay).toEqual([byId("footer")]);
  });

  it("keeps the root available when it is covered away from where a click would land", async () => {
    document.body.innerHTML =
      '<section id="root" style="position:fixed;left:0;top:0;width:200px;height:200px">Content</section><div style="position:fixed;left:0;top:0;width:200px;height:80px;z-index:10"></div>';

    expect(await observeRoot()).toEqual({
      present: true,
      available: true,
      inTheWay: [],
    });
  });

  it("names what covers where a click would land though most of the root is bare", async () => {
    document.body.innerHTML =
      '<section id="root" style="position:fixed;left:0;top:0;width:200px;height:200px">Content</section><div id="cover" style="position:fixed;left:0;top:0;width:200px;height:120px;z-index:10"></div>';

    expect(await observeRoot()).toEqual({
      present: true,
      available: false,
      inTheWay: [byId("cover")],
    });
  });
});
