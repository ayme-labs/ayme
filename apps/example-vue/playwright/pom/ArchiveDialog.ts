import type { Locator } from "@playwright/test";
import { AppComponent } from "./AppComponent";

export class ArchiveDialog extends AppComponent {
  readonly confirmArchiveButton: Locator;

  constructor(root: Locator) {
    super(root);
    this.confirmArchiveButton = root.getByRole("button", {
      name: "Confirm archive",
    });
  }

  async confirm() {
    await this.root.waitFor({ state: "visible" });
    await this.confirmArchiveButton.click();
    // The dialog animates out, so allow for the exit transition.
    await this.root.waitFor({ state: "hidden", timeout: 2_000 });
  }
}
