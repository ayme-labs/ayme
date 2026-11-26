import { describe, expect, it } from "vitest";

import { windowTitle } from "./windowTitle";

describe("the window's title", () => {
  it("names ayme capture alone while no page is open", () => {
    expect(windowTitle(null)).toBe("ayme capture");
  });

  it("names the address of the page that is open", () => {
    expect(windowTitle("https://shop.test/cart")).toBe(
      "ayme capture - https://shop.test/cart"
    );
  });
});
