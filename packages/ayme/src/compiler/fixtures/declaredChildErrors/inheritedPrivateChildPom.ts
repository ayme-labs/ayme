import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

class ListBase {
  @ayme.collection
  private readonly rows!: Locator;
}

@ayme
export class InheritedPrivateChildPom extends ListBase {
  @ayme.child
  readonly heading!: Locator;
}
