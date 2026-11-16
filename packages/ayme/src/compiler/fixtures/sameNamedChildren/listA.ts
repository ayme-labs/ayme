import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme({ root: (self: Row) => self.row })
export class Row {
  readonly row!: Locator;

  @ayme.action
  async open(): Promise<void> {}
}
