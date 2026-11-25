import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

const rootOf = (self: AppComponent) => self.root;

/** A component of the fixture app, anchored at its `root`. */
@ayme({ root: rootOf })
export abstract class AppComponent {
  constructor(readonly root: Locator) {}
}
