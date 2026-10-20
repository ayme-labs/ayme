import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

import { fieldLabel, listName } from "./withoutAymePomLabels";

export const ITEM_NAME = fieldLabel("Item name");

@ayme
export default class ListPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get dialog(): Locator {
    return this.page.getByRole("dialog");
  }

  @ayme.action({ description: "Add an item to the list." })
  async addItem(name: string) {
    await this.page.getByLabel(ITEM_NAME).fill(`${listName()} ${name}`);
  }
}
