import { ayme } from "@ayme-dev/ayme";
import type { Page } from "@playwright/test";

import { page, title } from "./withoutAymeKeysPomLabels";

// Both name `page` without referring to the import: a key and a member.
export const route = { page: "Home", title: title() };
export const placeOf = (place: { page: string }) => place.page;

@ayme
export class HomePage {
  private readonly browser: Page;

  constructor(browser: Page) {
    this.browser = browser;
  }

  @ayme.action({ description: "Open the home page." })
  async open() {
    await this.browser.goto(page());
  }
}
