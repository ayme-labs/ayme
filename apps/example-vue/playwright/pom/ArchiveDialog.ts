import { WebMCP } from "@ayme-dev/webmcp";
import type { Locator } from "@playwright/test";

@WebMCP
export class ArchiveDialog {
  readonly root: Locator;
  readonly confirmArchiveButton: Locator;

  constructor(root: Locator) {
    this.root = root;
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
