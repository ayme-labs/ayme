import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

class PageObjectBase {
  private readonly root!: Locator;
  private readonly internalButton!: Locator;
}

@ayme
export class PrivateRootPom extends PageObjectBase {
  readonly actionButton!: Locator;
}
