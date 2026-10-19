import { ayme } from "@ayme-dev/ayme";
import type { Page } from "@playwright/test";

@ayme
export class ListPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  @ayme.action({ description: "Add an item to the list." })
  async addItem(name: string) {
    await this.page.getByLabel("Item name").fill(name);
  }
}
