import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";
import type { ArchiveDialog } from "./ArchiveDialog";

@ayme
export class ListItem {
  readonly root: Locator;
  readonly archiveButton: Locator;
  readonly nameButton: Locator;
  readonly nameInput: Locator;

  constructor(
    root: Locator,
    private readonly archiveDialog: ArchiveDialog
  ) {
    this.root = root;
    this.archiveButton = root.locator('[data-action="archive"]');
    this.nameButton = root.locator('[data-action="rename"]');
    this.nameInput = root.getByRole("textbox", { name: "Item name" });
  }

  @ayme.action({
    description: "Archive this list item.",
  })
  async archive() {
    await this.archiveButton.click();
    await this.archiveDialog.confirm();
  }

  @ayme.action({
    description: "Rename this list item.",
  })
  async rename(text: string) {
    await this.nameButton.click();
    await this.nameInput.fill("");
    await this.nameInput.pressSequentially(text, { delay: 60 });
    await this.nameInput.press("Enter");
  }
}
