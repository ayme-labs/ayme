import { afterEach, describe, expect, it } from "vitest";
import { createPage } from "./browserPage";
import { probePomRootState } from "./pomReachability";

import type { Locator } from "@playwright/test";

// Preserve the original availability matrix while testing presence separately.
const probePomReachability = async (locator: Locator) =>
  (await probePomRootState(locator)).available;

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

    await expect(probePomRootState(root)).resolves.toEqual({
      present: true,
      available: true,
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

  it("does not mistake a covered center for a fully obstructed root", async () => {
    document.body.innerHTML =
      '<section id="root" style="position:fixed;left:0;top:0;width:200px;height:200px">Sidebar</section><div style="position:fixed;left:80px;top:80px;width:40px;height:40px;z-index:10"></div>';
    await expect(
      probePomReachability(createPage().locator("#root"))
    ).resolves.toBe(true);
  });

  it("does not bypass a fullscreen overlay for below-fold roots", async () => {
    document.body.innerHTML =
      '<div style="height:2000px"></div><section id="root" style="height:100px">Below fold</section><div style="position:fixed;inset:0;z-index:10"></div>';
    await expect(
      probePomReachability(createPage().locator("#root"))
    ).resolves.toBe(false);
  });

  it("accepts another scroll destination when the centered one is covered", async () => {
    document.body.innerHTML =
      '<div style="height:1600px"></div><section id="root" style="height:120px">Below fold</section><div style="position:fixed;left:0;right:0;top:35%;height:30%;z-index:10"></div><div style="height:1600px"></div>';
    await expect(
      probePomReachability(createPage().locator("#root"))
    ).resolves.toBe(true);
  });

  it("rejects an offscreen root covered by a sibling that scrolls with it", async () => {
    document.body.innerHTML =
      '<div style="overflow:auto;height:200px;position:relative"><div style="height:500px"></div><div style="position:relative;height:100px"><section id="root" style="position:absolute;inset:0">Panel</section><div style="position:absolute;inset:0;z-index:10"></div></div></div>';
    await expect(
      probePomReachability(createPage().locator("#root"))
    ).resolves.toBe(false);
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
      '<section id="root" style="width:200px;height:100px">Panel</section><div style="position:fixed;inset:0;z-index:10"></div>';
    await expect(
      probePomRootState(createPage().locator("#root"))
    ).resolves.toEqual({
      present: true,
      available: false,
    });
  });

  it("uses modal opening order rather than DOM order", async () => {
    document.body.innerHTML =
      '<dialog id="first"><button id="active">Confirm</button></dialog><dialog id="second"><button id="blocked">Earlier dialog</button></dialog>';
    document.querySelector<HTMLDialogElement>("#second")!.showModal();
    document.querySelector<HTMLDialogElement>("#first")!.showModal();
    const page = createPage();
    await expect(probePomRootState(page.locator("#active"))).resolves.toEqual({
      present: true,
      available: true,
    });
    await expect(probePomRootState(page.locator("#blocked"))).resolves.toEqual({
      present: true,
      available: false,
    });
    document.querySelector<HTMLDialogElement>("#first")!.close();
    await expect(probePomRootState(page.locator("#blocked"))).resolves.toEqual({
      present: true,
      available: true,
    });
  });

  it("lets a modal escape inherited inertness but respects inert inside it", async () => {
    document.body.innerHTML =
      '<div inert><dialog id="modal"><section id="panel"><button id="root">Confirm</button></section></dialog></div>';
    const modal = document.querySelector<HTMLDialogElement>("#modal")!;
    modal.showModal();
    const root = createPage().locator("#root");
    await expect(probePomRootState(root)).resolves.toEqual({
      present: true,
      available: true,
    });
    modal.inert = true;
    await expect(probePomRootState(root)).resolves.toEqual({
      present: true,
      available: false,
    });
    modal.inert = false;
    document.querySelector<HTMLElement>("#panel")!.inert = true;
    await expect(probePomRootState(root)).resolves.toEqual({
      present: true,
      available: false,
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
    await expect(probePomRootState(root)).resolves.toEqual({
      present: false,
      available: false,
    });
  });

  it("rejects a root clipped by circle(0)", async () => {
    document.body.innerHTML =
      '<button id="root" style="position:fixed;left:20px;top:20px;width:120px;height:80px;clip-path:circle(0)">Clipped</button>';
    await expect(
      probePomRootState(createPage().locator("#root"))
    ).resolves.toEqual({
      present: false,
      available: false,
    });
  });
});
