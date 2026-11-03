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
  @ayme.child
  readonly saveButton!: Locator;

  @ayme.action
  save() {}
}

@ayme
export class RootlessChildrenPom {
  @ayme.child
  readonly toolbar!: Toolbar;

  @ayme.collection
  async rows(): Promise<Row[]> {
    return [];
  }
}
