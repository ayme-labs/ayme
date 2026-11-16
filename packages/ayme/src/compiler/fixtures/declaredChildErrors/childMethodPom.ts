import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme({ root: (self: Row) => self.root })
class Row {
  readonly root!: Locator;
}

@ayme
export class ChildMethodPom {
  // @ts-expect-error @ayme.child declares a field or getter.
  @ayme.child
  async rows(): Promise<Row[]> {
    return [];
  }
}
