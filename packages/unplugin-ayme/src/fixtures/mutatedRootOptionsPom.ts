import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

const rootOf = (self: { container: Locator }) => self.container;

// The initializer shows no root, but a later call adds one: the compiler
// cannot read the options.
const assigned = { description: "An item." };
Object.assign(assigned, { root: rootOf });

@ayme(assigned)
class AssignedItem {
  constructor(readonly container: Locator) {}

  @ayme.action
  open() {}
}

// The literal inherits its root through `__proto__`: the keys it shows are
// not all it has.
const anchored = { root: rootOf };
const inherited = { __proto__: anchored, description: "An item." };

@ayme(inherited)
class InheritedItem {
  constructor(readonly container: Locator) {}

  @ayme.action
  open() {}
}

// Another decorator receives the same options before `ayme` does and may
// add a root to them: the compiler cannot read the options.
function addRoot<T extends object>(options: T) {
  Object.assign(options, { root: rootOf });
  return <Class>(target: Class) => target;
}

const decorated = { description: "An item." };

@addRoot(decorated)
@ayme(decorated)
class DecoratedItem {
  constructor(readonly container: Locator) {}

  @ayme.action
  open() {}
}

@ayme
export class MutatedRootOptionsPom {
  async assigned(): Promise<AssignedItem[]> {
    return [];
  }

  async inherited(): Promise<InheritedItem[]> {
    return [];
  }

  async decorated(): Promise<DecoratedItem[]> {
    return [];
  }
}
