import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

/**
 * A Page Object of the fixture's `plain.html`, which does not run Ayme. It
 * lives outside the app; `ayme mcp` serves it through the entry beside it.
 */
@ayme
export class PlainPage {
  @ayme.child
  readonly note: Locator;

  constructor(page: Page) {
    this.note = page.getByText("does not run Ayme");
  }

  @ayme.action({ description: "Read the page's note." })
  async readNote() {
    return this.note.textContent();
  }
}
