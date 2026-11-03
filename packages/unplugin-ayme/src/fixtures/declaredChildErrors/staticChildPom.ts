import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme
export class StaticChildPom {
  @ayme.child
  static heading: Locator;
}
