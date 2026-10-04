import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

/**
 * A Page Object the page registers and unregisters on demand, so its Page
 * Object Tool comes and goes while a page stays connected.
 */
@ayme
export class Basket {
  readonly heading: Locator;

  constructor(page: Page) {
    this.heading = page.getByRole("heading", { name: "Groceries" });
  }

  @ayme.action({ description: "Read the basket's heading." })
  async readHeading() {
    return this.heading.textContent();
  }
}
