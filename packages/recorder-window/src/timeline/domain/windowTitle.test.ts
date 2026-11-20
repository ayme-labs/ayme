import { describe, expect, it } from "vitest";

import { windowTitle } from "./windowTitle";

describe("the window's title", () => {
  it("names the recorder alone while no page is open", () => {
    expect(windowTitle(null)).toBe("Ayme Recorder");
  });

  it("names the address of the page that is open", () => {
    expect(windowTitle("https://shop.test/cart")).toBe(
      "Ayme Recorder - https://shop.test/cart"
    );
  });
});
