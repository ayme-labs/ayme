import type { Locator } from "@playwright/test";

import { ayme, ayme as mark } from "@ayme-dev/ayme";

const rootOf = (self: { container: Locator }) => self.container;
const options = { description: "An item." };

// The base declares its root through the aliased decorator, and the row
// inherits it: the collection is valid.
@mark({ root: rootOf })
class Base {
  constructor(readonly container: Locator) {}
}

@mark(options)
export class Other {}

@ayme(options)
class Row extends Base {
  @ayme.action
  open() {}
}

@ayme
export class AliasedInheritedRootPom {
  async rows(): Promise<Row[]> {
    return [];
  }
}
