import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme
export class BothMarkersPom {
  @ayme.child
  @ayme.collection
  readonly heading!: Locator;
}
