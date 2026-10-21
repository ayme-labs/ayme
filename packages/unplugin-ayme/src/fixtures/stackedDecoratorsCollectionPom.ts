import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

// Stacked decorators merge at runtime: the root is on the second.
@ayme({ present: () => true })
@ayme({ root: (self: Item) => self.container })
class Item {
  constructor(readonly container: Locator) {}

  @ayme.action
  open() {}
}

@ayme
export class StackedDecoratorsCollectionPom {
  async items(): Promise<Item[]> {
    return [];
  }
}
