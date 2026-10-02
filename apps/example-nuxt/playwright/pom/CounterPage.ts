import { WebMCP } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

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
}
