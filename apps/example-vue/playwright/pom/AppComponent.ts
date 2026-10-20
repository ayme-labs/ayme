import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

const rootOf = (self: AppComponent) => self.root;

/** A component of the app, anchored at its root: the element it is. */
@ayme({ root: rootOf })
export abstract class AppComponent {
  constructor(readonly root: Locator) {}
}
