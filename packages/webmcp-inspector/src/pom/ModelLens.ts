import type { Locator } from "@playwright/test";

import { dragBy } from "./pointerDrag";

export type ModelPaneName = "On this page" | "Page object models";

/**
 * The Model lens's tree in the navigator: the Page Objects on this page and
 * the Page Object Models the page knows, in two collapsible panes.
 */
export class ModelLens {
  readonly root: Locator;
  /** The object tree, "On this page". */
  readonly objectTree: Locator;
  /** The Page Object Model list, "Page object models". */
  readonly modelList: Locator;
  readonly models: Locator;
  /** The divider between the two panes. */
  readonly divider: Locator;

  constructor(root: Locator) {
    this.root = root;
    this.objectTree = root.getByRole("tree", { name: "Page objects" });
    this.modelList = root.getByRole("list", { name: "Page object models" });
    this.models = this.modelList.getByRole("button");
    this.divider = root.getByRole("separator", {
      name: "Resize the two lists",
    });
  }

  pane(name: ModelPaneName): Locator {
    return this.root.getByRole("region", { name, exact: true });
  }

  /** The button that collapses or expands a pane. */
  paneToggle(name: ModelPaneName): Locator {
    return this.pane(name).getByRole("button", {
      name: new RegExp(`^${name} · \\d+$`),
    });
  }

  async togglePane(name: ModelPaneName) {
    await this.paneToggle(name).click();
  }

  /** An object in the tree, by its path, e.g. "ListPage.items[1]", or "Page /" for the page. */
  object(path: string): Locator {
    return this.objectTree.getByRole("treeitem", { name: path, exact: true });
  }

  /** A Page Object Model in the list, by class name. */
  model(className: string): Locator {
    return this.modelList.getByRole("button", { name: className, exact: true });
  }

  /** The class names in the model list, in order. */
  async modelNames(): Promise<string[]> {
    const names = await Promise.all(
      (await this.models.all()).map((model) => model.getAttribute("aria-label"))
    );
    return names.map((name) => name ?? "");
  }

  /** Whether an object or a model is marked as not on the page. */
  async isNotOnPage(item: Locator) {
    return (await item.getAttribute("aria-description")) === "Not on page";
  }

  async dragDivider(deltaY: number) {
    await dragBy(this.divider, 0, deltaY);
  }
}
