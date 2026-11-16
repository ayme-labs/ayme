import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme
export class PrivateChildPom {
  @ayme.child
  private readonly heading!: Locator;
}
