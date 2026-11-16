import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme
export class LocatorMethodPom {
  @ayme.collection
  cells(): Locator {
    return undefined as unknown as Locator;
  }
}
