import type { Locator, Page } from "@playwright/test";

/** A page of the recorder: the window. */
export abstract class RecorderPage {
  constructor(readonly page: Page) {}
}

/** A part of the window or the toolbar, rooted at the element it is: its
 * members are scoped to that root. */
export abstract class RecorderPart {
  constructor(readonly root: Locator) {}
}
