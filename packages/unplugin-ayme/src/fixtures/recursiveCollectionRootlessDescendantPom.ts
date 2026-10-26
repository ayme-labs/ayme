import type { Locator } from "@playwright/test";
import { ayme } from "@ayme-dev/ayme";

@ayme
class Toolbar {}

@ayme({
  root: (self: RecursiveCollectionRootlessDescendantPom) => self.element,
})
export class RecursiveCollectionRootlessDescendantPom {
  element!: Locator;
  toolbar = new Toolbar();
  async children(): Promise<RecursiveCollectionRootlessDescendantPom[]> {
    return [];
  }
}
