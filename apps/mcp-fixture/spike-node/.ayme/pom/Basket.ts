import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

/** Spike: the basket screen. */
@ayme
export class Basket {
  @ayme.child
  readonly heading: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole("heading", { name: "Groceries" });
  }

  @ayme.collection
  async rows(): Promise<BasketItem[]> {
    return (await this.page.getByRole("listitem").all()).map(
      (root) => new BasketItem(root)
    );
  }

  @ayme.action({ description: "Open the detail screen." })
  async openDetail() {
    await this.page.getByRole("link", { name: "Open detail" }).click();
  }
}

/** Spike: one basket row. */
@ayme({ root: (self: BasketItem) => self.root })
export class BasketItem {
  constructor(readonly root: Locator) {}

  @ayme.action({ description: "Remove the row." })
  async remove() {
    await this.root.getByRole("button", { name: "Remove" }).click();
    await this.root.evaluate((element) => element.remove());
  }
}
