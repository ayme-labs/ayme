import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme({ root: (self: Item) => self.root })
class Item {
  readonly root!: Locator;
}

@ayme
class DeclaredBase {
  @ayme.collection({ description: "The list's rows." })
  readonly rows!: Locator;

  @ayme.collection
  async items(): Promise<Item[]> {
    return [];
  }
}

export class InheritedDeclaredChildrenPom extends DeclaredBase {
  @ayme.child({ description: "The list's title." })
  readonly title!: Locator;
}
