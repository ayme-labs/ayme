import { describe, expect, it } from "vitest";

import { launchOptions } from "./codegen";

describe("how codegen launches the browser", () => {
  it("opens the URL in a browser with a window", () => {
    expect(launchOptions("http://localhost:5173/cart", {})).toEqual({
      url: "http://localhost:5173/cart",
      headless: false,
    });
  });

  it("launches without a window when the tests ask for it", () => {
    expect(
      launchOptions("http://localhost", { AYME_RECORDER_HEADLESS: "1" })
    ).toEqual({ url: "http://localhost", headless: true });
  });

  it("opens the debug port the tests name", () => {
    expect(
      launchOptions("http://localhost", { AYME_RECORDER_DEBUG_PORT: "9333" })
    ).toEqual({ url: "http://localhost", headless: false, debugPort: 9333 });
  });
});
