import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

/**
 * The Page Object `/other` registers in place of `GroceriesPage`, with a
 * `hold` of its own.
 */
@ayme
export class OtherPage {
  constructor(private readonly page: Page) {}

  @ayme.child
  get heading(): Locator {
    return this.page.getByRole("heading", { level: 1 });
  }

  @ayme.action({ description: "Read the other page's heading." })
  async readHeading() {
    return this.heading.textContent();
  }

  /** Never answers, so a call stays in flight; marks <html> `data-holding`. */
  @ayme.action({ description: "Keep the call in flight; it never answers." })
  hold(): Promise<never> {
    document.documentElement.dataset.holding = "true";
    return new Promise(() => {});
  }
}
