import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme
class TopPom {
  @ayme.child
  readonly topButton!: Locator;

  @ayme.action({ description: "Use the top tool." })
  topTool() {}
}

class MiddlePom extends TopPom {
  @ayme.child
  readonly middleButton!: Locator;
}

export class BottomPom extends MiddlePom {
  @ayme.child
  readonly bottomButton!: Locator;

  @ayme.action({ description: "Use the bottom tool." })
  bottomTool() {}
}
