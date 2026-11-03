import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme({ root: (self: Row) => self.root })
class Row {
  readonly root!: Locator;
}

@ayme
export class MultiOverloadedCollectionPom {
  async refresh(): Promise<void> {}

  rows(): Promise<Row[]>;
  rows(limit: number): Promise<Row[]>;
  @ayme.collection
  async rows(limit?: number): Promise<Row[]> {
    void limit;
    return [];
  }
}
