import type { Locator } from "@playwright/test";
import { ayme } from "@ayme-dev/ayme";

@ayme
class Toolbar {}

@ayme({ root: (self: RecursiveRootlessDescendantPom) => self.element })
export class RecursiveRootlessDescendantPom {
  element!: Locator;
  toolbar = new Toolbar();
  next!: RecursiveRootlessDescendantPom;
}
