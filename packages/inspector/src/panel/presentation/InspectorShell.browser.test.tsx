import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cdp } from "vitest/browser";
// The Playwright provider gives `cdp()` its calls.
import type {} from "@vitest/browser-playwright";
import { createPage } from "@ayme-dev/playwright-lite";

import { renderPart } from "../../testing/renderPart";
import { Inspector } from "../../testing";
import { spring, springEasing } from "../domain/motion";
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

  it("drags by its header again from where the last drag left it", async () => {
    renderShell({ layout: "float", float: floating });

    await header.dragBy(-150, 60);
    await expect
      .poll(() => shell.box())
      .toEqual({ ...floating, x: 250, y: 100 });
    await header.dragBy(50, 20);

    await expect
      .poll(() => shell.box())
      .toEqual({ ...floating, x: 300, y: 120 });
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

  it.each([
    ["left", "vertical"],
    ["right", "vertical"],
    ["top", "horizontal"],
    ["bottom", "horizontal"],
    ["top-left", null],
    ["bottom-right", null],
  ] as const)(
    "says which way its %s handle resizes",
    async (handle, orientation) => {
      renderShell({ layout: "float", float: floating });

      expect(
        await shell.resizeHandle(handle).getAttribute("aria-orientation")
      ).toBe(orientation);
    }
  );
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

  // The drag takes hold of the title's centre: the floating panel keeps it
  // as far along its width as it was along the docked one, and as far down.
  it.each([
    ["left", { x: 0, y: 0, width: 600 }, 300, 200],
    ["right", { x: 680, y: 0, width: 600 }, -300, 200],
    ["bottom", { x: 0, y: 500, width: 1280 }, 0, -200],
  ] as const)(
    "floats a panel docked %s with the pointer where it took hold of the header",
    async (layout, docked, deltaX, deltaY) => {
      renderShell({
        layout,
        float: floating,
        sideWidth: 600,
        bottomHeight: 300,
      });
      const title = await header.title.boundingBox();
      const grab = {
        x: title!.x + title!.width / 2,
        y: title!.y + title!.height / 2,
      };

      await header.dragBy(deltaX, deltaY);

      await expect.poll(() => header.layoutMenu.current()).toBe("Floating");
      const { x, y } = await shell.box();
      // Layout places the panel on a 1/64px grid.
      expect(x).toBeCloseTo(
        grab.x + deltaX - ((grab.x - docked.x) / docked.width) * 700,
        1
      );
      expect(y).toBeCloseTo(grab.y + deltaY - (grab.y - docked.y), 1);
    }
  );

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

  // The browser clicks where a drag of the logo ends, since the logo moved
  // with the pointer.
  it("doesn't open on the click that ends a drag of the logo, but on the next", async () => {
    renderShell({ collapsed: true, logo: { x: 1000, y: 600 } });

    await logo.dragBy(-100, -100);
    await logo.root.dispatchEvent("click");
    expect(await inspector.panel.count()).toBe(0);
    await logo.root.press("Enter");

    await expect.poll(() => inspector.panel.isVisible()).toBe(true);
  });

  it("says the panel it opens is collapsed", async () => {
    renderShell({ collapsed: true });

    expect(
      await inspector.container
        .getByRole("button", { name: "Open ayme", expanded: false })
        .count()
    ).toBe(1);
  });
});

describe("motion", () => {
  // The component tests run with reduced motion (vitest.config.ts); these
  // turn it off in the browser, for its media queries and the stylesheet.
  function emulateMotion(value: "no-preference" | "reduce") {
    return cdp().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value }],
    });
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    await emulateMotion("reduce");
  });

  // The panel and the logo leave hidden from the accessibility tree, which
  // the page objects' role queries go by, so these find them by element.
  const aside = inspector.container.locator("aside");
  const logoButton = inspector.container.locator(
    'button[aria-label="Open ayme"]'
  );

  /** The panel's glides, as their axis and the time each is at. */
  function glides() {
    return inspector.panel.evaluate((panel) =>
      panel
        .getAnimations()
        .filter((animation) => !(animation instanceof CSSTransition))
        .map((animation) => ({
          translate: String(
            (animation.effect as KeyframeEffect).getKeyframes()[0].translate
          ),
          time: Number(animation.currentTime),
        }))
    );
  }

  /** Holds every glide at a moment of it, still running. */
  function holdGlides(time: number) {
    return inspector.panel.evaluate((panel, at) => {
      for (const animation of panel.getAnimations()) {
        if (animation instanceof CSSTransition) continue;
        animation.playbackRate = 0;
        animation.currentTime = at;
      }
    }, time);
  }

  /** The glides' timing: how long each lasts and how it eases. */
  function glideTimings() {
    return inspector.panel.evaluate((panel) =>
      panel
        .getAnimations()
        .filter((animation) => !(animation instanceof CSSTransition))
        .map((animation) => {
          const { duration, easing } = animation.effect!.getTiming();
          return { duration, easing };
        })
    );
  }

  /** An easing as the browser writes it back. */
  function asTheBrowserWrites(easing: string) {
    return new KeyframeEffect(null, null, { easing }).getTiming().easing;
  }

  it("glides to a layout chosen from the menu from where it was, at its new size from the start", async () => {
    await emulateMotion("no-preference");
    renderShell({ layout: "float", float: floating, sideWidth: 600 });

    await header.layoutMenu.choose("Dock right");

    expect(await glideTimings()).toEqual([
      { duration: spring.duration, easing: asTheBrowserWrites(springEasing()) },
      { duration: spring.duration, easing: asTheBrowserWrites(springEasing()) },
    ]);
    await holdGlides(0);
    expect(await shell.box()).toEqual({
      x: 400,
      y: 40,
      width: 600,
      height: 800,
    });
    await holdGlides(spring.duration);
    expect(await shell.box()).toEqual({
      x: 680,
      y: 0,
      width: 600,
      height: 800,
    });
  });

  it("glides only the way it moves", async () => {
    await emulateMotion("no-preference");
    renderShell({
      layout: "float",
      float: { ...floating, x: 0 },
      sideWidth: 600,
    });

    await header.layoutMenu.choose("Dock left");

    expect(await glides()).toEqual([{ translate: "0px 40px", time: 0 }]);
    await holdGlides(0);
    expect(await shell.box()).toEqual({ x: 0, y: 40, width: 600, height: 800 });
  });

  it("glides on from where it shows when another layout is chosen mid-glide", async () => {
    await emulateMotion("no-preference");
    renderShell({ layout: "float", float: floating, sideWidth: 600 });
    await header.layoutMenu.choose("Dock right");
    await holdGlides(100);
    const midway = await shell.box();

    await header.layoutMenu.choose("Dock left");

    await holdGlides(0);
    expect(await shell.box()).toEqual(midway);
    await holdGlides(spring.duration);
    expect(await shell.box()).toEqual({ x: 0, y: 0, width: 600, height: 800 });
  });

  it("keeps its glide when the layout it's gliding to is chosen again", async () => {
    await emulateMotion("no-preference");
    renderShell({ layout: "float", float: floating, sideWidth: 600 });
    await header.layoutMenu.choose("Dock right");
    await holdGlides(100);

    await header.layoutMenu.choose("Dock right");

    expect((await glides()).map(({ time }) => time)).toEqual([100, 100]);
  });

  it("drags from where the panel shows mid-glide, and stops the glide", async () => {
    await emulateMotion("no-preference");
    renderShell({
      layout: "left",
      float: { ...floating, x: 0 },
      sideWidth: 600,
    });
    await header.layoutMenu.choose("Floating");
    await holdGlides(100);
    const midway = await shell.box();

    await header.dragBy(100, 50);

    // Layout places the panel on a 1/64px grid.
    await expect
      .poll(async () => {
        const { x, y } = await shell.box();
        return [Math.round(x - midway.x), Math.round(y - midway.y)];
      })
      .toEqual([100, 50]);
    expect(await glides()).toEqual([]);
  });

  // Each move of the drag comes 10 ms after the one before, by the clock
  // the panel reads, and it's let go 10 ms after the last: 150 px up over
  // the last 40 ms, 3750 px/s toward the dock above. The glide starts with
  // that speed as a share of the way it has to go.
  it("settles into the dock it's dropped on at the speed it was let go", async () => {
    await emulateMotion("no-preference");
    renderShell({
      layout: "float",
      float: { ...floating, y: 300, height: 400 },
      sideWidth: 600,
    });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const tick = () => {
      now += 10;
    };
    window.addEventListener("pointermove", tick, { capture: true });
    window.addEventListener("pointerup", tick, { capture: true });
    const title = await header.title.boundingBox();

    try {
      await header.dropAt(4, title!.y + title!.height / 2 - 200);
    } finally {
      window.removeEventListener("pointermove", tick, { capture: true });
      window.removeEventListener("pointerup", tick, { capture: true });
    }

    await expect.poll(() => header.layoutMenu.current()).toBe("Dock left");
    const timings = await glideTimings();
    const keyframes = await glides();
    const down = keyframes.findIndex(({ translate }) =>
      translate.startsWith("0px ")
    );
    // How far the glide has to go up, from where the panel showed.
    const way = Number(/^0px ([\d.]+)px$/.exec(keyframes[down].translate)?.[1]);
    expect(way).toBeGreaterThan(0);
    expect(timings[down].easing).toBe(
      asTheBrowserWrites(springEasing(3750 / way))
    );
  });

  it("moves at once with reduced motion", async () => {
    renderShell({ layout: "float", float: floating, sideWidth: 600 });

    await header.layoutMenu.choose("Dock right");

    expect(await shell.box()).toEqual({
      x: 680,
      y: 0,
      width: 600,
      height: 800,
    });
    expect(await glides()).toEqual([]);
  });

  it("drags a panel still growing out of the logo from where it's going", async () => {
    await emulateMotion("no-preference");
    renderShell({ collapsed: true, layout: "float", float: floating });
    await logo.open();
    await inspector.panel.evaluate((panel) => {
      for (const animation of panel.getAnimations()) {
        animation.pause();
        animation.currentTime = 0;
      }
    });

    await header.dragBy(-100, 50);
    await inspector.panel.evaluate((panel) => {
      for (const animation of panel.getAnimations()) animation.finish();
    });

    await expect
      .poll(() => shell.box())
      .toEqual({ ...floating, x: 300, y: 90 });
  });

  it("shrinks the logo away as it opens, and the panel into the logo as it collapses, each gone once there", async () => {
    await emulateMotion("no-preference");
    renderShell({ collapsed: true, layout: "float", float: floating });

    await logo.open();

    // Leaving, the logo is out of the accessibility tree and out of reach.
    expect(await logo.root.count()).toBe(0);
    expect(await logoButton.count()).toBe(1);
    expect(
      await logoButton.evaluate((button) => {
        (button as HTMLElement).focus();
        return button.matches(":focus");
      })
    ).toBe(false);
    await expect.poll(() => logoButton.count()).toBe(0);

    await inspector.collapse();

    expect(await inspector.panel.count()).toBe(0);
    expect(await aside.count()).toBe(1);
    await expect.poll(() => aside.count()).toBe(0);
  });

  it("turns the same panel back when the logo is opened before the panel has gone", async () => {
    await emulateMotion("no-preference");
    renderShell({ layout: "float", float: floating });
    await aside.evaluate((panel) => Object.assign(panel, { same: true }));

    await inspector.collapse();
    expect(await aside.count()).toBe(1);
    await logo.root.press("Enter");

    await expect.poll(() => logoButton.count()).toBe(0);
    expect(await inspector.panel.evaluate((panel) => "same" in panel)).toBe(
      true
    );
    expect(await shell.box()).toEqual(floating);
  });

  it("fades and grows in when opened from the logo, but not when it starts open", async () => {
    await emulateMotion("no-preference");
    renderShell({ layout: "float", float: floating });
    // The shell renders at once, so an entrance would already be under way.
    expect(await transitions()).toEqual([]);
    const started = await recordTransitions();
    await inspector.collapse();
    await expect.poll(() => aside.count()).toBe(0);
    const closing = (await started()).length;

    await logo.open();

    await expect
      .poll(async () => (await started()).slice(closing).sort())
      .toEqual(["opacity", "scale"]);
  });

  it.each([
    ["floating", "float", "624px 584px"],
    ["docked left", "left", "1024px 624px"],
    ["docked right", "right", "344px 624px"],
    ["docked to the bottom", "bottom", "1024px 124px"],
  ] as const)(
    "grows out of the logo and shrinks back into it when %s",
    async (_how, layout, transformOrigin) => {
      renderShell({
        layout,
        float: floating,
        sideWidth: 600,
        bottomHeight: 300,
        logo: { x: 1000, y: 600 },
      });

      expect(
        await inspector.panel.evaluate(
          (panel) => (panel as HTMLElement).style.transformOrigin
        )
      ).toBe(transformOrigin);
    }
  );

  /** The transitions the panel runs now, by the property each moves. */
  function transitions() {
    return inspector.panel.evaluate((panel) =>
      panel
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.transitionProperty)
    );
  }

  /**
   * Records the transitions the panel starts from now on, by the property
   * each moves, and returns the call that reads them.
   */
  async function recordTransitions() {
    type Recording = Element & { started?: string[] };
    await inspector.container.evaluate((container: Recording) => {
      const started: string[] = [];
      container.started = started;
      container.addEventListener("transitionrun", (event) => {
        const { propertyName, target } = event as TransitionEvent;
        if ((target as Element).matches("aside")) started.push(propertyName);
      });
    });
    return () =>
      inspector.container.evaluate(
        (container: Recording) => container.started ?? []
      );
  }
});

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
