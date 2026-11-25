import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

/** Spike: the detail screen, present only there. */
@ayme({ root: (self: Detail) => self.heading })
export class Detail {
  @ayme.child
  readonly heading: Locator;
  @ayme.child
  readonly saved: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole("heading", { name: "Detail" });
    this.saved = page.locator("#saved");
  }

  @ayme.action({ description: "Save a name." })
  async save(name: string) {
    await this.page.getByRole("textbox", { name: "Name" }).fill(name);
    await this.page.getByRole("button", { name: "Save" }).click();
  }

  @ayme.action({ description: "Go back to the basket." })
  async back() {
    await this.page.getByRole("link", { name: "Back" }).click();
  }
}
