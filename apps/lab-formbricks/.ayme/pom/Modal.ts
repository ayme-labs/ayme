import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";
import { AppComponent } from "./AppComponent";

/** A dialog closed by its Close button. */
export class Modal extends AppComponent {
  @ayme.child
  readonly closeButton: Locator;

  constructor(root: Locator) {
    super(root);
    this.closeButton = root.getByRole("button", { name: "Close", exact: true });
  }

  @ayme.action
  async close() {
    await this.closeButton.click();
    await this.root.waitFor({ state: "hidden" });
    return this;
  }
}
