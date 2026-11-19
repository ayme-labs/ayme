import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

@ayme
export class AliasedPage {
  constructor(private readonly page: Page) {}

  @ayme.child
  get homeLink(): Locator {
    return this.page.getByRole("link", { name: "Home" });
  }

  @ayme.action({ description: "Go home." })
  async goHome() {
    await this.homeLink.click();
  }
}
