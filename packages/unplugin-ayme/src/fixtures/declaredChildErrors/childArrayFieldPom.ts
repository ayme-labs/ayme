import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme({ root: (self: Row) => self.root })
class Row {
  readonly root!: Locator;
}

@ayme
export class ChildArrayFieldPom {
  @ayme.child
  readonly rows!: readonly Row[];
}
