import { describe, expect, it } from "vitest";

import {
  defaultFloat,
  dockSize,
  dragFloat,
  fitFloat,
  fitSizes,
  growOrigin,
  inset,
  placement,
  resize,
  resizeFloat,
} from "./geometry";

describe("resizeFloat", () => {
  // A phone-sized viewport: the panel can't reach its minimum size here.
  const narrow = { width: 320, height: 568 };

  it("keeps a left-edge resize on screen in a narrow viewport", () => {
    const panel = { x: 0, y: 0, width: 300, height: 500 };

    expect(resizeFloat(panel, ["left"], { x: 10, y: 0 }, narrow)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 500,
    });
  });

  it("keeps a top-edge resize on screen in a short viewport", () => {
    const panel = { x: 0, y: 100, width: 300, height: 400 };

    expect(resizeFloat(panel, ["top"], { x: 0, y: 20 }, narrow)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 500,
    });
  });
});

describe("fitFloat", () => {
  // 1440×900 at 200% zoom: shorter than the panel's minimum height.
  const zoomed = { width: 720, height: 450 };

  it("fits the first panel whole at 200% zoom", () => {
    expect(fitFloat(defaultFloat(zoomed), zoomed)).toEqual({
      x: 156,
      y: 0,
      width: 540,
      height: 450,
    });
  });

  it("moves a panel up when the viewport shrinks below its height", () => {
    const panel = { x: 156, y: 24, width: 540, height: 800 };

    expect(fitFloat(panel, zoomed)).toEqual({
      x: 156,
      y: 0,
      width: 540,
      height: 450,
    });
  });

  it("moves a panel in when the viewport shrinks below its height, so it fits whole", () => {
    // Saved fully visible at 1440×900, at the page's right edge.
    const panel = { x: 876, y: 24, width: 540, height: 800 };

    expect(fitFloat(panel, zoomed)).toEqual({
      x: 180,
      y: 0,
      width: 540,
      height: 450,
    });
  });

  it("moves a panel in when the viewport narrows below its width", () => {
    const panel = { x: 100, y: 24, width: 800, height: 600 };

    expect(fitFloat(panel, { width: 700, height: 900 })).toEqual({
      x: 0,
      y: 24,
      width: 700,
      height: 600,
    });
  });

  it("raises a short panel to its minimum height, still on the page", () => {
    const panel = { x: 100, y: 300, width: 540, height: 400 };

    expect(fitFloat(panel, { width: 1440, height: 900 })).toEqual({
      x: 100,
      y: 300,
      width: 540,
      height: 520,
    });
    expect(fitFloat(panel, { width: 1440, height: 600 })).toEqual({
      x: 100,
      y: 80,
      width: 540,
      height: 520,
    });
  });

  it("keeps a panel moved low on the page by its header", () => {
    const panel = { x: 100, y: 820, width: 540, height: 600 };

    expect(fitFloat(panel, { width: 1440, height: 900 })).toEqual({
      x: 100,
      y: 820,
      width: 540,
      height: 600,
    });
    expect(fitFloat({ ...panel, y: 880 }, { width: 1440, height: 900 }).y).toBe(
      850
    );
  });

  it("keeps a panel moved partly off either side by 120px of it", () => {
    const panel = { x: 1380, y: 24, width: 540, height: 600 };
    const page = { width: 1440, height: 900 };

    expect(fitFloat(panel, page).x).toBe(1320);
    expect(fitFloat({ ...panel, x: -500 }, page).x).toBe(-420);
  });
});

// The panel in a 1280×800 viewport, floating clear of every edge.
const viewport = { width: 1280, height: 800 };
const sizes = {
  float: { x: 400, y: 40, width: 700, height: 600 },
  sideWidth: 600,
  bottomHeight: 300,
};

describe("fitSizes", () => {
  it("starts a panel that never floated at the page's top right", () => {
    expect(fitSizes({ sideWidth: 600, bottomHeight: 300 }, viewport)).toEqual({
      ...sizes,
      float: { x: 716, y: 24, width: 540, height: 752 },
    });
  });

  it("keeps each dock within its bounds", () => {
    expect(
      fitSizes({ ...sizes, sideWidth: 2000, bottomHeight: 100 }, viewport)
    ).toEqual({ ...sizes, sideWidth: 1000, bottomHeight: 240 });
    expect(
      fitSizes({ ...sizes, bottomHeight: 2000 }, viewport).bottomHeight
    ).toBe(640);
    // Shorter than its largest, the bottom dock leaves the header's height.
    expect(
      fitSizes({ ...sizes, bottomHeight: 2000 }, { width: 1280, height: 600 })
        .bottomHeight
    ).toBe(550);
  });
});

describe("dockSize", () => {
  it("takes the side docks' width and the bottom dock's height", () => {
    expect(dockSize("left", sizes)).toBe(600);
    expect(dockSize("right", sizes)).toBe(600);
    expect(dockSize("bottom", sizes)).toBe(300);
  });
});

describe("placement", () => {
  it.each([
    ["float", { left: 400, top: 40, width: 700, height: 600 }],
    ["left", { left: 0, top: 0, bottom: 0, width: 600 }],
    ["right", { right: 0, top: 0, bottom: 0, width: 600 }],
    ["bottom", { left: 0, right: 0, bottom: 0, height: 300 }],
  ] as const)("places a panel laid out %s", (layout, expected) => {
    expect(placement(layout, sizes)).toEqual(expected);
  });
});

describe("inset", () => {
  it.each([
    ["left", { left: 8, top: 8, bottom: 8, width: 584 }],
    ["right", { right: 8, top: 8, bottom: 8, width: 584 }],
    ["bottom", { left: 8, right: 8, bottom: 8, height: 284 }],
  ] as const)("draws the %s dock in from its edges", (dock, expected) => {
    expect(inset(placement(dock, sizes), 8)).toEqual(expected);
  });
});

describe("growOrigin", () => {
  const logo = { x: 1000, y: 600 };

  it.each([
    ["floating", "float", { x: 624, y: 584 }],
    ["docked left", "left", { x: 1024, y: 624 }],
    ["docked right", "right", { x: 344, y: 624 }],
    ["docked to the bottom", "bottom", { x: 1024, y: 124 }],
  ] as const)(
    "grows out of the logo's centre when %s",
    (_how, layout, expected) => {
      expect(growOrigin(layout, sizes, logo, viewport)).toEqual(expected);
    }
  );
});

describe("dragFloat", () => {
  it("moves a floating panel with the pointer", () => {
    expect(
      dragFloat(
        sizes.float,
        { x: 750, y: 60 },
        { x: -150, y: 60 },
        sizes.float,
        viewport
      )
    ).toEqual({ ...sizes.float, x: 250, y: 100 });
  });

  // The pointer stays as far along the floating panel's width as it took
  // hold of the docked one, and as far down.
  it.each([
    [
      "left",
      { x: 0, y: 0, width: 600, height: 800 },
      { x: 150, y: 25 },
      { x: 300, y: 200 },
      { x: 275, y: 200 },
    ],
    [
      "right",
      { x: 680, y: 0, width: 600, height: 800 },
      { x: 980, y: 25 },
      { x: -300, y: 200 },
      { x: 330, y: 200 },
    ],
    [
      "bottom",
      { x: 0, y: 500, width: 1280, height: 300 },
      { x: 640, y: 525 },
      { x: 0, y: -200 },
      { x: 290, y: 300 },
    ],
  ] as const)(
    "floats a panel docked %s under the pointer where it took hold",
    (_dock, shown, press, delta, expected) => {
      expect(dragFloat(shown, press, delta, sizes.float, viewport)).toEqual({
        ...sizes.float,
        ...expected,
      });
    }
  );

  it("keeps the header on the page", () => {
    expect(
      dragFloat(
        sizes.float,
        { x: 750, y: 60 },
        { x: 0, y: -200 },
        sizes.float,
        viewport
      ).y
    ).toBe(0);
  });
});

describe("resize", () => {
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
  ] as const)(
    "resizes a floating panel from its %s",
    (handle, x, y, change) => {
      expect(resize("float", handle, sizes, { x, y }, viewport)).toEqual({
        float: { ...sizes.float, ...change },
      });
    }
  );

  it("keeps a resized edge inside the viewport", () => {
    expect(resize("float", "right", sizes, { x: 400, y: 0 }, viewport)).toEqual(
      { float: { ...sizes.float, width: 880 } }
    );
  });

  // A docked panel grows as its edge facing the page moves away from its dock.
  it.each([
    ["left", "right", 120, 0, { sideWidth: 720 }],
    ["right", "left", -120, 0, { sideWidth: 720 }],
    ["bottom", "top", 0, -100, { bottomHeight: 400 }],
  ] as const)("resizes a panel docked %s", (layout, handle, x, y, expected) => {
    expect(resize(layout, handle, sizes, { x, y }, viewport)).toEqual(expected);
  });

  it("keeps a docked panel within its dock's bounds", () => {
    expect(resize("left", "right", sizes, { x: 900, y: 0 }, viewport)).toEqual({
      sideWidth: 1000,
    });
    expect(resize("bottom", "top", sizes, { x: 0, y: 200 }, viewport)).toEqual({
      bottomHeight: 240,
    });
  });
});
