import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

/** A page of the recorder: the window. */
export abstract class RecorderPage {
  constructor(readonly page: Page) {}
}

const rootOf = (self: RecorderPart) => self.root;

/** A part of the window or the toolbar, rooted at the element it is: its
 * members are scoped to that root, which a Page Object Root must be for its
 * tools to be live. */
@ayme({ root: rootOf })
export abstract class RecorderPart {
  constructor(readonly root: Locator) {}
}
