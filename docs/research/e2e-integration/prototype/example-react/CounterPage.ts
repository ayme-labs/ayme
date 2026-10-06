import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

@ayme
export class CounterPage {
  readonly root: Locator;
  readonly incrementButton: Locator;
  constructor(page: Page) {
    this.root = page.getByRole("region", { name: "Counter" });
    this.incrementButton = this.root.getByRole("button", {
      name: "Increment",
      exact: true,
    });
  }
  @ayme.action({ description: "Increment the counter." })
  async increment() {
    await this.incrementButton.click();
  }
}
