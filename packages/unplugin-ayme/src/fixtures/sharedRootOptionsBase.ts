import type { Locator } from "@playwright/test";
import { ayme } from "@ayme-dev/ayme";

@ayme({ root: (self: RootedBase) => self.element })
export class RootedBase {
  element!: Locator;
}
