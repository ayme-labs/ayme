import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

/** Clearing needs something in the basket; the reason states the fact. */
const canClear = async (self: Basket) =>
  (await self.items.count()) > 0 || "The basket is empty";

/**
 * The basket of `shop.html`, rooted at its section, so it has a Page Object
 * Id. `clear` is unavailable while the basket is empty, and says why, and
 * is marked destructive, so `ayme tools` shows the mark.
 */
@ayme({ root: (self: Basket) => self.root })
export class Basket {
  constructor(private readonly page: Page) {}

  get root(): Locator {
    return this.page.getByRole("region", { name: "Basket" });
  }

  @ayme.collection
  get items(): Locator {
    return this.root.getByRole("listitem");
  }

  @ayme.action({ description: "Put an item in the basket." })
  async add(item: string) {
    await this.root.getByRole("textbox", { name: "Item" }).fill(item);
    // The page has no script of its own, so the action lists the item.
    await this.root
      .getByRole("list")
      .evaluate(
        (list, name) =>
          list.append(
            Object.assign(document.createElement("li"), { textContent: name })
          ),
        item
      );
  }

  @ayme.action({
    description: "Clear the basket.",
    available: canClear,
    destructive: true,
  })
  async clear() {
    await this.items.evaluateAll((items) =>
      items.forEach((item) => item.remove())
    );
  }
}
