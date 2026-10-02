import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

// The example imports this model through the tsconfig `paths` alias @pom/*.
@ayme
export class OtherPage {
  readonly homeLink: Locator;

  constructor(page: Page) {
    this.homeLink = page.getByRole("link", { name: "Home" });
  }

  @ayme.action({ description: "Go back to the counter page." })
  async goHome() {
    await this.homeLink.click();
  }
}
