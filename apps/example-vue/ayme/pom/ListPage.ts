import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";
import { AppPage } from "./AppPage";
import { ArchiveDialog, ListItem } from "./components";

export class ListPage extends AppPage {
  // The playground is served at the site root in development, and under
  // /playground or /ayme when deployed. ayme.dev drops the trailing slash.
  readonly path = "/{:base(playground|ayme)}?{/}?";

  @ayme.child
  get archiveDialog(): ArchiveDialog {
    return new ArchiveDialog(
      this.page.getByRole("dialog", { name: "Archive item" })
    );
  }

  @ayme.child
  get newItemInput(): Locator {
    return this.page.getByRole("textbox", { name: "New item" });
  }

  @ayme.child
  get addItemButton(): Locator {
    return this.page.getByRole("button", { name: "Add item" });
  }

  private get itemRows(): Locator {
    return this.page
      .getByRole("list", { name: "Active items" })
      .getByRole("listitem");
  }

  @ayme.collection
  async items(): Promise<ListItem[]> {
    const rows = await this.itemRows.all();
    return rows.map((row) => new ListItem(row, this.archiveDialog));
  }

  @ayme.action
  async addItem(text: string) {
    await this.newItemInput.fill("");
    await this.newItemInput.pressSequentially(text);
    await this.addItemButton.click();
  }
}
