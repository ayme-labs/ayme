import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

const rootOf = (self: { container: Locator }) => self.container;

const shared = { description: "An item." };

// A function that is only named `ayme` receives the options first and adds a
// root: the compiler cannot read the options.
{
  function ayme<T extends object>(options: T) {
    Object.assign(options, { root: rootOf });
    return <Class>(target: Class) => target;
  }

  @ayme(shared)
  class Shadowed {}
  void Shadowed;
}

@ayme(shared)
class ShadowedItem {
  constructor(readonly container: Locator) {}

  @ayme.action
  open() {}
}

@ayme
export class ShadowedAymeOptionsPom {
  async items(): Promise<ShadowedItem[]> {
    return [];
  }
}
