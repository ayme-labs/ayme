import type { RecordedVisit } from "@ayme-dev/recorder/contract";
import { describe, expect, it } from "vitest";

import { windowTitle } from "./windowTitle";

const visit = (url: string): RecordedVisit => ({
  visitId: url,
  url,
  cause: "navigate",
  entries: [],
});

describe("the window's title", () => {
  it("names the recorder alone before anything is recorded", () => {
    expect(windowTitle([])).toBe("Ayme Recorder");
  });

  it("names the address of the page the recording is on now", () => {
    expect(
      windowTitle([
        visit("https://shop.test/"),
        visit("https://shop.test/cart"),
      ])
    ).toBe("Ayme Recorder - https://shop.test/cart");
  });
});
