import { describe, expect, it } from "vitest";

import { dockedRect, nearestCorner, resizeFloat } from "./geometry";

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

describe("nearestCorner", () => {
  const panel = { x: 400, y: 40, width: 700, height: 600 };

  it.each([
    [{ x: 100, y: 0 }, "top left"],
    [{ x: 1200, y: 100 }, "top right"],
    [{ x: 300, y: 700 }, "bottom left"],
    [{ x: 1000, y: 500 }, "bottom right"],
  ] as const)("finds the corner nearest %o: %s", (point, corner) => {
    expect(nearestCorner(panel, point)).toBe(corner);
  });
});

describe("dockedRect", () => {
  const viewport = { width: 1280, height: 800 };

  it.each([
    ["left", 600, { x: 0, y: 0, width: 600, height: 800 }],
    ["right", 600, { x: 680, y: 0, width: 600, height: 800 }],
    ["bottom", 300, { x: 0, y: 500, width: 1280, height: 300 }],
  ] as const)("places a panel docked %s", (dock, size, rect) => {
    expect(dockedRect(dock, size, viewport)).toEqual(rect);
  });
});
