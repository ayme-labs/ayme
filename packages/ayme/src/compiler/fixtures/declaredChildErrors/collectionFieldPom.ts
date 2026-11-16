import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme({ root: (self: Toolbar) => self.root })
class Toolbar {
  readonly root!: Locator;
}

@ayme
export class CollectionFieldPom {
  @ayme.collection
  readonly toolbar!: Toolbar;
}
