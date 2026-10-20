import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

const rootOf = (self: PanelPart) => self.root;

/**
 * A part of the Inspector, anchored at its `root`: the element the part is,
 * which a Page Object Root must be for its tools to be live. The Inspector's
 * page objects extend it.
 */
@ayme({ root: rootOf })
export abstract class PanelPart {
  constructor(readonly root: Locator) {}
}
