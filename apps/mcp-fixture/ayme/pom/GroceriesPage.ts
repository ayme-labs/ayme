import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

/** The Page Object of the fixture's `/` page, the page's own. */
@ayme
export class GroceriesPage {
  constructor(private readonly page: Page) {}

  @ayme.child
  get heading(): Locator {
    return this.page.getByRole("heading", { level: 1 });
  }

  @ayme.action({ description: "Read the page's heading." })
  async readHeading() {
    return this.heading.textContent();
  }
}
