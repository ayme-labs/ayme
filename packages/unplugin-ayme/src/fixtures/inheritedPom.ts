import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

class BasePom {
  @ayme.child
  readonly inheritedButton!: Locator;

  @ayme.action({ description: "Use the inherited tool." })
  inheritedTool(value: string) {
    return value;
  }
}

@ayme
export class InheritedPom extends BasePom {
  @ayme.child
  readonly ownButton!: Locator;
}
