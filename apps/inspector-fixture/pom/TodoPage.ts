import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

import { AppComponent } from "./AppComponent";

/**
 * The model fixture's Page Object: a to-do list whose items are child Page
 * Objects, and an archive dialog that is not on the page. The runtime
 * constructs it on playwright-lite. Its locators are CSS, so they never match
 * the Inspector's own text.
 */
@ayme
export class TodoPage {
  readonly newItemInput: Locator;
  readonly addItemButton: Locator;
  readonly archiveDialog: ArchiveDialog;
  private readonly rows: Locator;

  constructor(page: Page) {
    this.newItemInput = page.locator("#todo-new");
    this.addItemButton = page.locator("#todo-add");
    this.rows = page.locator("#todo-items > li");
    this.archiveDialog = new ArchiveDialog(page.locator("#todo-archive"));
  }

  async items(): Promise<TodoItem[]> {
    return (await this.rows.all()).map((row) => new TodoItem(row));
  }

  @ayme.action
  async addItem(text: string) {
    await this.newItemInput.fill(text);
    await this.addItemButton.click();
  }
}

export class TodoItem extends AppComponent {
  readonly archiveButton: Locator;

  constructor(root: Locator) {
    super(root);
    this.archiveButton = root.locator(".todo-archive");
  }

  @ayme.action
  async archive() {
    await this.archiveButton.click();
  }
}

export class ArchiveDialog extends AppComponent {
  readonly confirmButton: Locator;

  constructor(root: Locator) {
    super(root);
    this.confirmButton = root.locator(".todo-confirm");
  }
}
