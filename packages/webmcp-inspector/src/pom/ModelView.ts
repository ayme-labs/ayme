import type { Locator } from "@playwright/test";

/** The Model view: the structural page state and the registered tools. */
export class ModelView {
  readonly root: Locator;
  readonly pageState: Locator;
  readonly refreshButton: Locator;

  constructor(root: Locator) {
    this.root = root;
    this.pageState = root.getByRole("region", {
      name: "Structural page state",
    });
    this.refreshButton = this.pageState.getByRole("button", {
      name: "Refresh",
    });
  }

  /** A registered tool's entry, with its availability and schema. */
  registeredTool(name: string): Locator {
    return this.root.locator(`[data-registered-tool="${name}"]`);
  }

  async refresh() {
    await this.refreshButton.click();
  }
}
