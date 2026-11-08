import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme({ root: (self: Row) => self.root })
class Row {
  readonly root!: Locator;
}

@ayme
export class ActionChildPom {
  @ayme.action
  @ayme.collection
  async rows(): Promise<Row[]> {
    return [];
  }
}
