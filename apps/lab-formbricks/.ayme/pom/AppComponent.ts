import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

const rootOf = (self: AppComponent) => self.root;

/** A part of a Formbricks page, present while its root is on the page. */
@ayme({ root: rootOf })
export abstract class AppComponent {
  constructor(readonly root: Locator) {}
}
