import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

/** Clearing needs something in the basket; the reason states the fact. */
const canClear = async (self: Basket) =>
  (await self.items.count()) > 0 || "The basket is empty";

/**
 * A Page Object the page registers and unregisters on demand, so its Page
 * Object Tool comes and goes while a page stays connected. Its `clear`
 * action is available only while the basket has items, so an agent meets
 * an unavailable tool with a reason.
 */
@ayme
export class Basket {
  readonly heading: Locator;
  readonly items: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole("heading", { name: "Groceries" });
    this.items = page.getByRole("listitem");
  }

  async rows(): Promise<BasketItem[]> {
    if (!new URL(this.page.url()).searchParams.has("class-tools")) return [];
    return (await this.items.all()).map((root) => new BasketItem(root));
  }

  @ayme.action
  async readHeading() {
    return this.heading.textContent();
  }

  @ayme.action({
    description: "Clear the basket. Needs an item in it.",
    available: canClear,
  })
  async clear() {
    await this.items.evaluateAll((items) =>
      items.forEach((item) => item.remove())
    );
  }
}

/** One basket row, addressed by its own root ref. */
@ayme({ root: (self: BasketItem) => self.root })
export class BasketItem {
  constructor(readonly root: Locator) {}

  @ayme.action
  async remove() {
    await this.root.evaluate((element) => element.remove());
  }
}
