import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

import { PanelPart } from "./PanelPart";
import { dragBy } from "./pointerDrag";

export type ModelPaneName = "On this page" | "Page object models";

/**
 * The Model lens's tree in the navigator: the Page Objects on this page and
 * the Page Object Models the page knows, in two collapsible panes.
 */
@ayme
export class ModelLens extends PanelPart {
  /** The object tree, "On this page". */
  readonly objectTree: Locator;
  /** The Page Object Model list, "Page object models". */
  readonly modelList: Locator;
  readonly models: Locator;
  /** The divider between the two panes. */
  readonly divider: Locator;

  constructor(root: Locator) {
    super(root);
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

  @ayme.action({ description: "Collapses or expands one of the two panes." })
  async togglePane(name: ModelPaneName) {
    await this.paneToggle(name).click();
  }

  /** An object in the tree, by its path, e.g. "ListPage.items[1]", or "Page /" for the page. */
  object(path: string): Locator {
    return this.objectTree.getByRole("treeitem", { name: path, exact: true });
  }

  /** Whether an object shows its children; null when it has none. */
  async isOpen(path: string): Promise<boolean | null> {
    const expanded = await this.object(path).getAttribute("aria-expanded");
    return expanded === null ? null : expanded === "true";
  }

  /** The paths of the objects the tree shows, in order. */
  async objectPaths(): Promise<string[]> {
    const items = await this.objectTree.getByRole("treeitem").all();
    const paths = await Promise.all(
      items.map((item) => item.getAttribute("aria-label"))
    );
    return paths.map((path) => path ?? "");
  }

  @ayme.action({
    description: "Opens or closes an object in the tree with its chevron.",
  })
  async toggleObject(path: string) {
    await this.object(path).locator("[data-toggle]").click();
  }

  @ayme.action({
    description: "Presses a key on an object in the tree, e.g. ArrowRight.",
  })
  async pressOnObject(path: string, key: string) {
    await this.object(path).press(key);
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

  @ayme.action({
    description:
      "Drags the divider between the two panes by a distance in pixels.",
  })
  async dragDivider(deltaY: number) {
    await dragBy(this.divider, 0, deltaY);
  }
}
