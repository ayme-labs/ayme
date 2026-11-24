import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

/** One basket row, addressed by its own root ref. */
@ayme({ root: (self: BasketItem) => self.root })
export class BasketItem {
  constructor(readonly root: Locator) {}

  @ayme.action
  async remove() {
    await this.root.evaluate((element) => element.remove());
  }
}
