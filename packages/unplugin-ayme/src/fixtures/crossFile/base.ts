import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme
export abstract class BaseMenu {
  readonly baseItem!: Locator;

  @ayme.action({ description: "Open the menu." })
  open() {}
}
