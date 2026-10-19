import { ayme } from "@ayme-dev/ayme";
import type { Page } from "@playwright/test";

import { itemLabel } from "./labels";

@ayme
export class ListPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  @ayme.action({ description: "Add an item to the list." })
  async addItem(name: string) {
    await this.page.getByLabel(itemLabel()).fill(name);
  }
}
