import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

export default class {
  @ayme.child
  readonly heading!: Locator;
}
