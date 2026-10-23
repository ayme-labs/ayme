import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { renderPart } from "../../testing/renderPart";
import { Inspector } from "../../testing";
import type { Preferences } from "../domain/preferences";
import { ShellHarness } from "../test-utils/ShellHarness";

// Component tests: the shell with fixture preferences, in a 1280×800
// viewport, driven through the Inspector's page objects on playwright-lite.
// The drags are pointer events dispatched to the handles (see pom/pointerDrag).

const viewport = { width: 1280, height: 800 };
// The shell renders into an open root this test owns.
const page = createPage();
const inspector = new Inspector(
  page,
  page.locator("[data-ayme-inspector-root]")
);
const { shell, header, logo } = inspector;
const unmounts: (() => void)[] = [];

beforeAll(() => {
  // The expected boxes assume this viewport (vitest.config.ts).
  if (
    window.innerWidth !== viewport.width ||
    window.innerHeight !== viewport.height
  )
    throw new Error(
      `The component tests need a ${viewport.width}×${viewport.height} viewport, not ${window.innerWidth}×${window.innerHeight}.`
    );
});

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

function renderShell(initial?: Partial<Preferences>) {
  unmounts.push(renderPart(<ShellHarness initial={initial} />));
}

const floating = { x: 400, y: 40, width: 700, height: 600 };

describe("floating", () => {
  it("drags by its header", async () => {
    renderShell({ layout: "float", float: floating });

    await header.dragBy(-150, 60);

    await expect
      .poll(() => shell.box())
      .toEqual({ ...floating, x: 250, y: 100 });
  });

  // Each handle drags its own sides; the opposite sides stay put.
  it.each([
    ["left", -100, 0, { x: 300, width: 800 }],
    ["right", 100, 0, { width: 800 }],
    ["top", 0, -30, { y: 10, height: 630 }],
    ["bottom", 0, 80, { height: 680 }],
    ["top-left", -100, -30, { x: 300, y: 10, width: 800, height: 630 }],
    ["top-right", 100, -30, { y: 10, width: 800, height: 630 }],
    ["bottom-left", -100, 80, { x: 300, width: 800, height: 680 }],
    ["bottom-right", 100, 80, { width: 800, height: 680 }],
  ] as const)("resizes from its %s", async (handle, deltaX, deltaY, change) => {
    renderShell({ layout: "float", float: floating });

    await shell.resizeBy(handle, deltaX, deltaY);

    await expect.poll(() => shell.box()).toEqual({ ...floating, ...change });
  });

  it("keeps a resized edge inside the viewport", async () => {
    renderShell({ layout: "float", float: floating });

    await shell.resizeBy("right", 400, 0);

    await expect.poll(() => shell.box()).toEqual({ ...floating, width: 880 });
  });
});

describe("docking", () => {
  it.each([
    ["left", 4, 300, "Dock left", { x: 0, y: 0, width: 600, height: 800 }],
    [
      "right",
      1276,
      300,
      "Dock right",
      { x: 680, y: 0, width: 600, height: 800 },
    ],
    [
      "bottom",
      640,
      796,
      "Dock to bottom",
      { x: 0, y: 500, width: 1280, height: 300 },
    ],
  ] as const)(
    "docks %s when dropped on that edge",
    async (_edge, x, y, layout, box) => {
      renderShell({
        layout: "float",
        float: floating,
        sideWidth: 600,
        bottomHeight: 300,
      });

      await header.dropAt(x, y);

      await expect.poll(() => header.layoutMenu.current()).toBe(layout);
      await expect.poll(() => shell.box()).toEqual(box);
    }
  );

  it("docks from the layout menu", async () => {
    renderShell({ layout: "float", float: floating, sideWidth: 600 });

    await header.layoutMenu.choose("Dock right");

    await expect
      .poll(() => shell.box())
      .toEqual({ x: 680, y: 0, width: 600, height: 800 });
  });

  it("floats again when a docked header is dragged", async () => {
    renderShell({ layout: "left", float: floating, sideWidth: 600 });

    await header.dragBy(300, 200);

    await expect.poll(() => header.layoutMenu.current()).toBe("Floating");
    const { width, height } = await shell.box();
    expect({ width, height }).toEqual({ width: 700, height: 600 });
  });

  it.each([
    ["left", "right", 120, 0, { x: 0, y: 0, width: 720, height: 800 }],
    ["right", "left", -120, 0, { x: 560, y: 0, width: 720, height: 800 }],
    ["bottom", "top", 0, -100, { x: 0, y: 400, width: 1280, height: 400 }],
  ] as const)(
    "resizes when docked %s",
    async (layout, edge, deltaX, deltaY, box) => {
      renderShell({ layout, sideWidth: 600, bottomHeight: 300 });

      await shell.resizeBy(edge, deltaX, deltaY);

      await expect.poll(() => shell.box()).toEqual(box);
    }
  );
});

describe("collapsed", () => {
  it("becomes the ayme logo, which opens the panel again", async () => {
    renderShell();

    await inspector.collapse();

    await expect.poll(() => inspector.panel.count()).toBe(0);
    await expect.poll(() => logo.root.isVisible()).toBe(true);
    await logo.open();
    await expect.poll(() => inspector.panel.isVisible()).toBe(true);
  });

  it("drags the logo anywhere without opening the panel", async () => {
    renderShell({ collapsed: true, logo: { x: 1000, y: 600 } });

    await logo.dragBy(-700, -450);

    await expect
      .poll(() => logo.root.boundingBox())
      .toEqual({ x: 300, y: 150, width: 48, height: 48 });
    expect(await inspector.panel.count()).toBe(0);
  });
});

describe("motion", () => {
  // The component tests run with reduced motion (vitest.config.ts). The
  // slide asks for the preference itself, so these tests can turn it off.
  function slides() {
    const matchMedia = window.matchMedia.bind(window);
    vi.spyOn(window, "matchMedia").mockImplementation((query) =>
      query === "(prefers-reduced-motion: reduce)"
        ? ({ matches: false } as MediaQueryList)
        : matchMedia(query)
    );
    const animate = vi.spyOn(Element.prototype, "animate");
    /** The last slide, held at a moment of it. */
    return (time: number) => {
      const slide = animate.mock.results.at(-1)?.value as Animation;
      slide.pause();
      slide.currentTime = time;
      return slide;
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens from the logo and docks from the menu in place at once, with reduced motion", async () => {
    renderShell({
      collapsed: true,
      layout: "float",
      float: floating,
      sideWidth: 600,
    });

    await logo.open();
    expect(await shell.box()).toEqual(floating);

    await header.layoutMenu.choose("Dock right");
    expect(await shell.box()).toEqual({
      x: 680,
      y: 0,
      width: 600,
      height: 800,
    });
  });

  it("slides to a layout chosen from the menu, at its new size from the start", async () => {
    const holdSlide = slides();
    renderShell({ layout: "float", float: floating, sideWidth: 600 });

    await header.layoutMenu.choose("Dock right");

    const { duration, easing } = holdSlide(0).effect!.getTiming();
    expect({ duration, easing }).toEqual({
      duration: 200,
      easing: "cubic-bezier(0.77, 0, 0.175, 1)",
    });
    expect(await shell.box()).toEqual({
      x: 400,
      y: 40,
      width: 600,
      height: 800,
    });
    holdSlide(200);
    expect(await shell.box()).toEqual({
      x: 680,
      y: 0,
      width: 600,
      height: 800,
    });
  });

  it("turns from where the panel is when another layout is chosen mid-slide", async () => {
    const holdSlide = slides();
    renderShell({ layout: "float", float: floating, sideWidth: 600 });
    await header.layoutMenu.choose("Dock right");
    holdSlide(100);
    const midway = await shell.box();

    await header.layoutMenu.choose("Dock left");

    holdSlide(0);
    expect(await shell.box()).toEqual(midway);
    holdSlide(200);
    expect(await shell.box()).toEqual({ x: 0, y: 0, width: 600, height: 800 });
  });

  it("slides down to the bottom from where it was", async () => {
    const holdSlide = slides();
    renderShell({ layout: "float", float: floating, bottomHeight: 300 });

    await header.layoutMenu.choose("Dock to bottom");

    holdSlide(0);
    const { x, y } = await shell.box();
    expect({ x, y }).toEqual({ x: 400, y: 40 });
  });

  it("doesn't slide into a dock it's dropped on, after its own layout was chosen from the menu", async () => {
    slides();
    renderShell({ layout: "float", float: floating, sideWidth: 600 });

    await header.layoutMenu.choose("Floating");
    await header.dropAt(4, 300);

    await expect.poll(() => header.layoutMenu.current()).toBe("Dock left");
    expect(Element.prototype.animate).not.toHaveBeenCalled();
  });

  it("fades in when opened from the logo, but not when it starts open", async () => {
    renderShell({ layout: "float", float: floating });
    const root = lastRoot();
    // The shell renders at once, so a fade would already be under way.
    expect(root.querySelector("aside")!.getAnimations()).toEqual([]);

    const fades: string[] = [];
    root.addEventListener("transitionrun", (event) => {
      const { propertyName, target } = event as TransitionEvent;
      if ((target as Element).localName === "aside") fades.push(propertyName);
    });
    await header.collapse();
    await logo.open();

    await expect.poll(() => fades).toContain("opacity");
  });

  it.each([
    ["docked", "left", { x: 676, y: 676 }, "right bottom"],
    ["floating", "float", { x: 740, y: 330 }, "right bottom"],
    ["floating", "float", { x: 700, y: 290 }, "left top"],
  ] as const)(
    "grows out of its corner nearest the logo when %s",
    async (_how, layout, logoAt, corner) => {
      renderShell({ layout, float: floating, sideWidth: 600, logo: logoAt });
      const root = lastRoot();
      await shell.box();

      expect(root.querySelector("aside")!.style.transformOrigin).toBe(corner);
    }
  );
});

/** The shadow root the last renderShell made. */
function lastRoot() {
  return document.body.lastElementChild!.shadowRoot!;
}

describe("the host page", () => {
  // The host page's content: the first thing in its body, full width.
  function renderHostContent() {
    const content = document.createElement("main");
    content.textContent = "The host page";
    content.style.height = "100px";
    document.body.prepend(content);
    unmounts.push(() => content.remove());
    const box = () => content.getBoundingClientRect();
    return {
      left: () => box().left,
      right: () => box().right,
      bottomRoom: () =>
        parseFloat(getComputedStyle(document.documentElement).paddingBottom),
    };
  }

  it.each([
    ["left", { left: 600, right: 1280 }],
    ["right", { left: 0, right: 680 }],
  ] as const)("moves aside for a panel docked %s", async (layout, edges) => {
    const host = renderHostContent();
    renderShell({ layout, sideWidth: 600 });

    await expect
      .poll(() => ({ left: host.left(), right: host.right() }))
      .toEqual(edges);
  });

  it("makes room at its bottom for a panel docked to the bottom", async () => {
    const host = renderHostContent();
    renderShell({ layout: "bottom", bottomHeight: 300 });

    await expect.poll(() => host.bottomRoom()).toBe(300);
  });

  it("follows a docked panel as it resizes", async () => {
    const host = renderHostContent();
    renderShell({ layout: "left", sideWidth: 600 });

    await shell.resizeBy("right", 100, 0);

    await expect.poll(() => host.left()).toBe(700);
  });

  it.each([
    ["floats", () => header.layoutMenu.choose("Floating")],
    ["collapses", () => inspector.collapse()],
  ])("gets its space back when the panel %s", async (_change, change) => {
    const host = renderHostContent();
    renderShell({ layout: "left", sideWidth: 600 });
    await expect.poll(() => host.left()).toBe(600);

    await change();

    await expect
      .poll(() => ({ left: host.left(), right: host.right() }))
      .toEqual({ left: 0, right: 1280 });
  });

  it("gets its space back when the panel unmounts", async () => {
    const host = renderHostContent();
    const unmount = renderPart(
      <ShellHarness initial={{ layout: "left", sideWidth: 600 }} />
    );
    await expect.poll(() => host.left()).toBe(600);

    unmount();

    expect(host.left()).toBe(0);
    expect(document.head.querySelector("[data-ayme-inspector-dock]")).toBe(
      null
    );
  });
});
