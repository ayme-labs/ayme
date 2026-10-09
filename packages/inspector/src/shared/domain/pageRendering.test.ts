import { expect, it } from "vitest";

import { INSPECTOR_PAGE_RENDERING_ATTRIBUTE } from "./pageRendering";

// Unit tests: the attribute the package exports for pages that dogfood the
// Inspector. Its value is public API: a page may match it in a selector.

it("names the page-rendering attribute as it is exported", () => {
  expect(INSPECTOR_PAGE_RENDERING_ATTRIBUTE).toBe(
    "data-ayme-inspector-page-rendering"
  );
});
