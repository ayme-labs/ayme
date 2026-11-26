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
  constructor(private readonly page: Page) {}

  @ayme.child
  get archiveDialog(): ArchiveDialog {
    return new ArchiveDialog(this.page.locator("#todo-archive"));
  }

  @ayme.child
  get newItemInput(): Locator {
    return this.page.locator("#todo-new");
  }

  @ayme.child
  get addItemButton(): Locator {
    return this.page.locator("#todo-add");
  }

  private get rows(): Locator {
    return this.page.locator("#todo-items > li");
  }

  @ayme.collection
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
  constructor(root: Locator) {
    super(root);
  }

  @ayme.child
  get archiveButton(): Locator {
    return this.root.locator(".todo-archive");
  }

  @ayme.action
  async archive() {
    await this.archiveButton.click();
  }
}

export class ArchiveDialog extends AppComponent {
  constructor(root: Locator) {
    super(root);
  }

  @ayme.child
  get confirmButton(): Locator {
    return this.root.locator(".todo-confirm");
  }
}
