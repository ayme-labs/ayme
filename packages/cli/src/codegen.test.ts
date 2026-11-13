import { describe, expect, it } from "vitest";

import { launchOptions, outcomeLine } from "./codegen";

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

describe("what the terminal is told at the end", () => {
  it("says that nothing was recorded", () => {
    expect(outcomeLine({ kind: "empty" })).toBe("Nothing was recorded.\n");
  });

  it("names the saved package's file, as the released recorder does", () => {
    expect(
      outcomeLine({
        kind: "saved",
        folder: "/project/.ayme/recordings/rec_20261112T145047604Z",
      })
    ).toBe(
      "Recording package: /project/.ayme/recordings/rec_20261112T145047604Z/package.yaml\n"
    );
  });
});
