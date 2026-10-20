import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

import { anchored } from "./rootOptions/anchoredOptions";

const rootOf = (self: { container: Locator }) => self.container;

function options() {
  return { root: rootOf };
}

// Options the compiler cannot read: a spread, an import, a call. Each item
// class may declare a root, so the runtime decides, and the collections
// build.
@ayme({ ...anchored })
class SpreadItem {
  constructor(readonly container: Locator) {}

  @ayme.action
  open() {}
}

@ayme(anchored)
class ImportedItem {
  constructor(readonly container: Locator) {}

  @ayme.action
  open() {}
}

@ayme(options())
abstract class CalledBase {
  constructor(readonly container: Locator) {}
}

// The unreadable options sit on a base class.
class CalledItem extends CalledBase {
  @ayme.action
  open() {}
}

@ayme
export class UnreadableRootOptionsPom {
  async spread(): Promise<SpreadItem[]> {
    return [];
  }

  async imported(): Promise<ImportedItem[]> {
    return [];
  }

  async called(): Promise<CalledItem[]> {
    return [];
  }
}
