import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

// Throws on the server, so a successful SSR render proves the adapter did not
// construct the Page Object there.
@ayme
export class CounterPage {
  readonly incrementButton: Locator;
  constructor(page: Page) {
    if (typeof window === "undefined")
      throw new Error("CounterPage must not be constructed on the server.");
    this.incrementButton = page.getByRole("button", {
      name: "Increment",
      exact: true,
    });
  }
  @ayme.action({ description: "Increment the counter." })
  async increment() {
    if (typeof window === "undefined")
      throw new Error("CounterPage actions are browser-only.");
    await this.incrementButton.click();
  }
}
