import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme
class TopPom {
  readonly topButton!: Locator;

  @ayme.action({ description: "Use the top tool." })
  topTool() {}
}

class MiddlePom extends TopPom {
  readonly middleButton!: Locator;
}

export class BottomPom extends MiddlePom {
  readonly bottomButton!: Locator;

  @ayme.action({ description: "Use the bottom tool." })
  bottomTool() {}
}
