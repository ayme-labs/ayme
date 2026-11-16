import type { Locator } from "@playwright/test";
import { ayme } from "@ayme-dev/ayme";

@ayme
class Toolbar {}

@ayme({
  root: (self: RecursiveCollectionRootlessDescendantPom) => self.element,
})
export class RecursiveCollectionRootlessDescendantPom {
  element!: Locator;
  @ayme.child
  toolbar = new Toolbar();
  @ayme.collection
  async children(): Promise<RecursiveCollectionRootlessDescendantPom[]> {
    return [];
  }
}
