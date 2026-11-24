import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";
import { AppComponent } from "./AppComponent";
import type { ArchiveDialog } from "./ArchiveDialog";

export class ListItem extends AppComponent {
  constructor(
    root: Locator,
    private readonly archiveDialog: ArchiveDialog
  ) {
    super(root);
  }

  @ayme.child
  get archiveButton(): Locator {
    return this.root.locator('[data-action="archive"]');
  }

  @ayme.child
  get nameButton(): Locator {
    return this.root.locator('[data-action="rename"]');
  }

  @ayme.child
  get nameInput(): Locator {
    return this.root.getByRole("textbox", { name: "Item name" });
  }

  @ayme.action({
    description: "An archived item can't be renamed or restored.",
    destructive: true,
  })
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
