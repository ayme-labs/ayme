import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

/**
 * A Page Object of the fixture's `plain.html`, which does not run Ayme. It
 * lives outside the app; `ayme mcp` serves it through the entry beside it.
 */
@ayme
export class PlainPage {
  constructor(private readonly page: Page) {}

  @ayme.child
  get note(): Locator {
    return this.page.getByText("does not run Ayme");
  }

  @ayme.action({ description: "Read the page's note." })
  async readNote() {
    return this.note.textContent();
  }
}
