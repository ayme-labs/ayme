import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { renderPart } from "../renderPart";
import { Inspector } from "../testing";
import type { Preferences } from "./preferences";
import { ShellHarness } from "./ShellHarness.testSupport";

// Component tests: the shell with fixture preferences, in a 1280×800
// viewport, driven through the Inspector's page objects on playwright-lite.
// The drags are pointer events dispatched to the handles (see pom/pointerDrag).

const viewport = { width: 1280, height: 800 };
const inspector = new Inspector(createPage());
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

  it("resizes from its left edge, keeping its right edge", async () => {
    renderShell({ layout: "float", float: floating });

    await shell.resizeBy("left", -100, 0);

    await expect
      .poll(() => shell.box())
      .toEqual({ ...floating, x: 300, width: 800 });
  });

  it("resizes from its bottom edge", async () => {
    renderShell({ layout: "float", float: floating });

    await shell.resizeBy("bottom", 0, 80);

    await expect.poll(() => shell.box()).toEqual({ ...floating, height: 680 });
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
