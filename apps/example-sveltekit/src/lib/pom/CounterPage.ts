import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";
import type { CounterMode } from "./CounterMode";

@ayme
export class CounterPage {
  readonly incrementButton: Locator;

  constructor(page: Page) {
    this.incrementButton = page.getByRole("button", {
      name: "Increment",
      exact: true,
    });
  }

  @ayme.action({ description: "Increment the counter." })
  async increment() {
    await this.incrementButton.click();
  }

  @ayme.action({ description: "Set counter mode metadata." })
  setMode(mode: CounterMode) {
    void mode;
  }
}
