import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

/** The bundle's edit marker: change it, rebuild, reload, and check the tool answers the new one. */
const VERSION = "v1";

/** The spike's static page: a heading, a text box and an Add button. */
@ayme
export class Notes {
  @ayme.child
  readonly heading: Locator;
  @ayme.collection
  readonly items: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole("heading", { level: 1 });
    this.items = page.getByRole("listitem");
  }

  @ayme.action({ description: "Read the page heading and the bundle version." })
  async readHeading() {
    return `${await this.heading.textContent()} (${VERSION})`;
  }

  @ayme.action({
    description: "Add a note through the page's own text box and button.",
  })
  async addNote(text: string) {
    await this.page.getByRole("textbox", { name: "Note" }).fill(text);
    await this.page.getByRole("button", { name: "Add" }).click();
    return this.items.allTextContents();
  }
}
