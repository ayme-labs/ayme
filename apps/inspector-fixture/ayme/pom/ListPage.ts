import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

import { ListItem } from "./ListItem";

/**
 * The fixture page's Page Object. The page registers it with the ayme
 * runtime, which constructs it on playwright-lite and publishes `addItem` as
 * a Page Object Tool; the e2e tests construct the same class on
 * Playwright to read the page.
 */
@ayme
export class ListPage {
  constructor(private readonly page: Page) {}

  @ayme.child
  get newItemInput(): Locator {
    return this.page.getByRole("textbox", { name: "New item" });
  }

  // The Inspector names its own buttons after the page's, inside an open
  // shadow root on the dogfood page, so the page's own are the ones in main.
  @ayme.child
  get addItemButton(): Locator {
    return this.page
      .getByRole("main")
      .getByRole("button", { name: "Add item" });
  }

  @ayme.child
  get clearButton(): Locator {
    return this.page.getByRole("main").getByRole("button", { name: "Clear" });
  }

  @ayme.collection
  get items(): Locator {
    return this.page.getByRole("list", { name: "Items" }).getByRole("listitem");
  }

  @ayme.collection({
    description: "The new item's fields: its text and whether it is urgent.",
  })
  get newItemFields(): Locator {
    return this.page.getByRole("main").locator("input");
  }

  /** The items, as Page Objects a collection action runs on. */
  @ayme.collection
  async entries(): Promise<ListItem[]> {
    return (await this.items.all()).map((item) => new ListItem(item));
  }

  @ayme.action
  async addItem(text: string) {
    await this.newItemInput.fill(text);
    await this.addItemButton.click();
  }

  @ayme.action
  async countItems() {
    return this.items.count();
  }

  // Available only while the list has items (ADR-0062): on an empty list
  // the tool is listed, and a call is refused with this reason. Marked
  // destructive, so the Inspector marks it and WebMCP publishes it with
  // `consequentialHint`.
  @ayme.action({
    description: "Remove every item from the list.",
    available: async (self: ListPage) =>
      (await self.items.count()) > 0 || "Nothing to clear",
    destructive: true,
  })
  async clear() {
    await this.clearButton.click();
  }
}
