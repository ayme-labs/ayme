import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

/**
 * The fixture's `shop.html`, which does not run ayme. Written as for a
 * Playwright test: a Session runs it in Node, on Playwright.
 */
@ayme
export class ShopPage {
  constructor(private readonly page: Page) {}

  @ayme.child
  get heading(): Locator {
    return this.page.getByRole("heading", { level: 1 });
  }

  @ayme.action({ description: "Read the shop's heading." })
  async readHeading() {
    return this.heading.textContent();
  }
}
