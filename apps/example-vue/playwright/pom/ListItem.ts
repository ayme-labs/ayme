import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";
import { AppComponent } from "./AppComponent";
import type { ArchiveDialog } from "./ArchiveDialog";

export class ListItem extends AppComponent {
  readonly archiveButton: Locator;
  readonly nameButton: Locator;
  readonly nameInput: Locator;

  constructor(
    root: Locator,
    private readonly archiveDialog: ArchiveDialog
  ) {
    super(root);
    this.archiveButton = root.locator('[data-action="archive"]');
    this.nameButton = root.locator('[data-action="rename"]');
    this.nameInput = root.getByRole("textbox", { name: "Item name" });
  }

  @ayme.action
  async archive() {
    await this.archiveButton.click();
    await this.archiveDialog.confirm();
  }

  @ayme.action
  async rename(text: string) {
    await this.nameButton.click();
    await this.nameInput.fill("");
    await this.nameInput.pressSequentially(text);
    await this.nameInput.press("Enter");
  }
}
