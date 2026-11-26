import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

/**
 * The list of the fixture's own app page, `/`, which ships ayme: a Session's
 * Page Object on a page whose own runtime is a second Host. Rooted, so the
 * Session gives it a Page Object Id of its own.
 */
@ayme({ root: (self: GroceryList) => self.root })
export class GroceryList {
  constructor(private readonly page: Page) {}

  get root(): Locator {
    return this.page.locator("#basket-items");
  }

  @ayme.collection
  get items(): Locator {
    return this.root.getByRole("listitem");
  }

  @ayme.action({ description: "Count the items on the list." })
  async count() {
    return this.items.count();
  }
}
