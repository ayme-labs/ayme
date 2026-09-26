import type { Locator } from "@playwright/test";

/** A structure node's detail: what it is, who owns it, and its Ref tools. */
export class NodeView {
  readonly root: Locator;
  /** The node as the page state lists it, e.g. `e3 button "Add item"`. */
  readonly title: Locator;
  /** The Page Object member it maps to; opens the Page Object that owns it. */
  readonly memberLink: Locator;
  /** The Ref tools that run on it. */
  readonly tools: Locator;

  constructor(detail: Locator) {
    this.root = detail.getByRole("article", { name: "Structure node" });
    this.title = this.root.getByRole("heading", { level: 2 });
    this.memberLink = this.root
      .getByRole("group", { name: "Page object member" })
      .getByRole("button");
    this.tools = this.root.getByRole("region", { name: "Tools" });
  }

  async openOwner() {
    await this.memberLink.click();
  }
}
