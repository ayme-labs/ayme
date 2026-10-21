import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

const options = { root: (self: Item) => self.container };

// Options in a constant are not read; the runtime checks them.
@ayme(options)
class Item {
  constructor(readonly container: Locator) {}

  @ayme.action
  open() {}
}

@ayme
export class ConstOptionsCollectionPom {
  async items(): Promise<Item[]> {
    return [];
  }
}
