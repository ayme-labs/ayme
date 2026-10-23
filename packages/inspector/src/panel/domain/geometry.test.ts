import { describe, expect, it } from "vitest";

import { defaultFloat, fitFloat, resizeFloat } from "./geometry";

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
});
