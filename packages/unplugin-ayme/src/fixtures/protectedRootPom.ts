import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

class PageObjectBase {
  protected readonly root!: Locator;
  protected readonly internalButton!: Locator;
}

@ayme
export class ProtectedRootPom extends PageObjectBase {
  readonly actionButton!: Locator;
}
