import type { Locator, Page } from "@playwright/test";

/**
 * The fixture page's Page Object. The page registers it with the Ayme
 * runtime, which constructs it on playwright-lite and publishes `addItem` as
 * a Generated WebMCP Tool; the e2e tests construct the same class on
 * Playwright to read the page.
 */
export class ListPage {
  readonly newItemInput: Locator;
  readonly addItemButton: Locator;
  readonly items: Locator;

  constructor(page: Page) {
    this.newItemInput = page.getByRole("textbox", { name: "New item" });
    this.addItemButton = page.getByRole("button", { name: "Add item" });
    this.items = page
      .getByRole("list", { name: "Items" })
      .getByRole("listitem");
  }

  /** Add an item to the list. */
  async addItem(text: string) {
    await this.newItemInput.fill(text);
    await this.addItemButton.click();
  }
}
