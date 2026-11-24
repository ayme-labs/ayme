import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

/**
 * The Page Object of the fixture's `/` page, registered while it shows. Its
 * tools tell the e2e tests which page is paired, `hold` keeps a call in
 * flight, `fail` throws, and the others load another document, as an action
 * that follows a link does.
 */
@ayme
export class GroceriesPage {
  constructor(private readonly page: Page) {}

  @ayme.child
  get heading(): Locator {
    return this.page.getByRole("heading", { level: 1 });
  }

  @ayme.action({ description: "Read the page's heading." })
  async readHeading() {
    return this.heading.textContent();
  }

  /** Never answers, so a call stays in flight; marks <html> `data-holding`. */
  @ayme.action({ description: "Keep the call in flight; it never answers." })
  hold(): Promise<never> {
    document.documentElement.dataset.holding = "true";
    return new Promise(() => {});
  }

  @ayme.action({ description: "Fail, as an action whose page broke does." })
  fail(): never {
    throw new Error("The fixture's action failed.");
  }

  @ayme.action({ description: "Open the other page." })
  openOther() {
    location.assign("/other");
  }

  @ayme.action({ description: "Open a page of the app without ayme." })
  openPlain() {
    location.assign("/plain.html");
  }

  @ayme.action({ description: "Reload the page." })
  reload() {
    location.reload();
  }
}

/**
 * The Page Object `/other` registers in place of `GroceriesPage`, with a
 * `hold` of its own.
 */
@ayme
export class OtherPage {
  constructor(private readonly page: Page) {}

  @ayme.child
  get heading(): Locator {
    return this.page.getByRole("heading", { level: 1 });
  }

  @ayme.action({ description: "Read the other page's heading." })
  async readHeading() {
    return this.heading.textContent();
  }

  /** Never answers, so a call stays in flight; marks <html> `data-holding`. */
  @ayme.action({ description: "Keep the call in flight; it never answers." })
  hold(): Promise<never> {
    document.documentElement.dataset.holding = "true";
    return new Promise(() => {});
  }
}
