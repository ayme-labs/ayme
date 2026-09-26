import type { Locator } from "@playwright/test";

/** The skeleton Structure lens: the structural page state as text. */
export class PageStateView {
  readonly root: Locator;
  readonly refreshButton: Locator;

  constructor(navigator: Locator) {
    this.root = navigator.getByRole("region", {
      name: "Structural page state",
    });
    this.refreshButton = this.root.getByRole("button", { name: "Refresh" });
  }

  async refresh() {
    await this.refreshButton.click();
  }
}
