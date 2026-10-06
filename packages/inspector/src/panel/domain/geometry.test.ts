import { describe, expect, it } from "vitest";

import { resizeFloat } from "./geometry";

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
