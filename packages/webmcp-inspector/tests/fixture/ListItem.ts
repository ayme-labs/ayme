import type { Locator } from "@playwright/test";

/** An item on the fixture page's list: a Page Object in a collection. */
export class ListItem {
  readonly root: Locator;

  constructor(root: Locator) {
    this.root = root;
  }

  /** Mark this item done or to do. */
  async mark(state: "done" | "todo") {
    await this.root.evaluate(
      (item, value) => item.setAttribute("data-state", value),
      state
    );
  }
}
