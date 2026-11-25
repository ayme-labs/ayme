import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

import { BasketItem } from "./BasketItem";

/** Clearing needs something in the basket; the reason states the fact. */
const canClear = async (self: Basket) =>
  (await self.items.count()) > 0 || "The basket is empty";

/**
 * A Page Object the page registers and unregisters on demand, so its Page
 * Object Tool comes and goes while a page stays connected. Its `clear`
 * action is available only while the basket has items, so an agent meets
 * an unavailable tool with a reason, and is marked destructive, so its MCP
 * tool carries `destructiveHint`.
 */
@ayme
export class Basket {
  constructor(private readonly page: Page) {}

  @ayme.child
  get heading(): Locator {
    return this.page.getByRole("heading", { name: "Groceries" });
  }

  @ayme.collection
  get items(): Locator {
    return this.page.getByRole("listitem");
  }

  @ayme.collection
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
    destructive: true,
  })
  async clear() {
    await this.items.evaluateAll((items) =>
      items.forEach((item) => item.remove())
    );
  }
}
