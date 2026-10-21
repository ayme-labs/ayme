import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme({ root: (self: BaseItem) => self.container })
class BaseItem {
  constructor(readonly container: Locator) {}
}

// Bare `@ayme`: the root comes from the base.
@ayme
class Item extends BaseItem {
  @ayme.action
  open() {}
}

@ayme
export class InheritedRootCollectionPom {
  async items(): Promise<Item[]> {
    return [];
  }
}
