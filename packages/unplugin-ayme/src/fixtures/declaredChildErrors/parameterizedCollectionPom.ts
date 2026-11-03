import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme({ root: (self: Row) => self.root })
class Row {
  readonly root!: Locator;
}

@ayme
export class ParameterizedCollectionPom {
  @ayme.collection
  async rows(filter: string): Promise<Row[]> {
    void filter;
    return [];
  }
}
