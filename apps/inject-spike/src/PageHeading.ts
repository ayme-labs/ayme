import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

/** A trivial Page Object for any public site: reads the title and the first h1. */
@ayme
export class PageHeading {
  @ayme.child
  readonly heading: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.locator("h1").first();
  }

  @ayme.action({ description: "Read the document title and the first h1." })
  async read() {
    const h1 =
      (await this.heading.count()) > 0
        ? await this.heading.textContent()
        : null;
    return { title: await this.page.title(), h1: h1?.trim() ?? null };
  }
}
