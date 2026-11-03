import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme({ root: (self: Row) => self.root })
class Row {
  readonly root!: Locator;
}

@ayme
export class MutableArrayMethodPom {
  @ayme.collection
  visibleRows(): Row[] {
    return [];
  }
}
