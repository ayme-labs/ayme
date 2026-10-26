import type { Locator } from "@playwright/test";
import { ayme } from "@ayme-dev/ayme";

@ayme
class Toolbar {}

@ayme({ root: (self: Row) => self.element })
class Row {
  element!: Locator;
  toolbar = new Toolbar();
}

@ayme
export class RootlessDescendantPom {
  async rows(): Promise<Row[]> {
    return [];
  }
}
