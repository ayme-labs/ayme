import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme
export class ProtectedChildPom {
  @ayme.collection
  protected readonly rows!: Locator;
}
