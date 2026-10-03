import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

@ayme
export class AliasedPage {
  readonly homeLink: Locator;

  constructor(page: Page) {
    this.homeLink = page.getByRole("link", { name: "Home" });
  }

  @ayme.action({ description: "Go home." })
  async goHome() {
    await this.homeLink.click();
  }
}
