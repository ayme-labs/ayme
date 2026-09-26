import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { AYME_LOGO_FILL, AYME_LOGO_PATH, AYME_LOGO_VIEWBOX } from "./logo";

const markSvg = readFileSync(
  new URL("../logo/mark.svg", import.meta.url),
  "utf8"
);

describe("the Ayme mark", () => {
  it("draws the same mark as logo/mark.svg", () => {
    expect(markSvg).toContain(`viewBox="${AYME_LOGO_VIEWBOX}"`);
    expect(markSvg).toContain(`d="${AYME_LOGO_PATH}"`);
    expect(markSvg.toLowerCase()).toContain(
      `fill="${AYME_LOGO_FILL.toLowerCase()}"`
    );
  });
});
