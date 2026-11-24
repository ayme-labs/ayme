import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";
import type { CounterMode } from "./CounterMode";

@ayme
export class CounterPage {
  constructor(private readonly page: Page) {}

  @ayme.child
  get incrementButton(): Locator {
    return this.page.getByRole("button", {
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
