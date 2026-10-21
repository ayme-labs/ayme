import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme({ root: (self: AppComponent) => self.container })
abstract class AppComponent {
  constructor(readonly container: Locator) {}
}

// Inherits its root from the base: a collection of it builds.
class Row extends AppComponent {
  @ayme.action
  open() {}
}

// No root in its chain: a single child of it builds.
@ayme
class Toolbar {
  readonly saveButton!: Locator;

  @ayme.action
  save() {}
}

@ayme
export class RootlessChildrenPom {
  readonly toolbar!: Toolbar;

  async rows(): Promise<Row[]> {
    return [];
  }
}
