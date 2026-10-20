import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

const rootOf = (self: { container: Locator }) => self.container;

// The options are a constant of this file: the compiler reads the `root`
// key there.
const anchored = { root: rootOf };

@ayme(anchored)
class NamedOptionsItem {
  constructor(readonly container: Locator) {}

  @ayme.action
  open() {}
}

// A computed key that is a string literal names the option.
@ayme({ ["root"]: rootOf })
class ComputedKeyItem {
  constructor(readonly container: Locator) {}

  @ayme.action
  open() {}
}

// The constant is read through a type assertion and a second constant.
const asserted = { root: rootOf } as const;
const alias = asserted;

@ayme(alias)
class AliasedOptionsItem {
  constructor(readonly container: Locator) {}

  @ayme.action
  open() {}
}

@ayme
export class ReadableRootOptionsPom {
  async named(): Promise<NamedOptionsItem[]> {
    return [];
  }

  async computed(): Promise<ComputedKeyItem[]> {
    return [];
  }

  async aliased(): Promise<AliasedOptionsItem[]> {
    return [];
  }
}
