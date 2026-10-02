import { WebMCP } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";
import type { CounterMode } from "./CounterMode";

@WebMCP
export class CounterPage {
  readonly incrementButton: Locator;

  constructor(page: Page) {
    this.incrementButton = page.getByRole("button", {
      name: "Increment",
      exact: true,
    });
  }

  @WebMCP.tool({ description: "Increment the counter." })
  async increment() {
    await this.incrementButton.click();
  }

  @WebMCP.tool({ description: "Set counter mode metadata." })
  setMode(mode: CounterMode) {
    void mode;
  }
}
