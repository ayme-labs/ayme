import type { Locator, Page } from "@playwright/test";

import { ListItem } from "./ListItem";

/**
 * The fixture page's Page Object. The page registers it with the Ayme
 * runtime, which constructs it on playwright-lite and publishes `addItem` as
 * a Page Object Tool; the e2e tests construct the same class on
 * Playwright to read the page.
 */
export class ListPage {
  readonly newItemInput: Locator;
  readonly addItemButton: Locator;
  readonly clearButton: Locator;
  readonly items: Locator;

  constructor(page: Page) {
    this.newItemInput = page.getByRole("textbox", { name: "New item" });
    this.addItemButton = page.getByRole("button", { name: "Add item" });
    // The Inspector's Runs view has a "Clear" button too.
    this.clearButton = page.getByRole("button", { name: "Clear" });
    this.items = page
      .getByRole("list", { name: "Items" })
      .getByRole("listitem");
  }

  /** The items, as Page Objects a collection action runs on. */
  async entries(): Promise<ListItem[]> {
    return (await this.items.all()).map((item) => new ListItem(item));
  }

  /** Add an item to the list. */
  async addItem(text: string) {
    await this.newItemInput.fill(text);
    await this.addItemButton.click();
  }

  /** Count the items on the list. */
  async countItems() {
    return this.items.count();
  }

  /** Remove every item from the list. */
  async clear() {
    await this.clearButton.click();
  }
}
