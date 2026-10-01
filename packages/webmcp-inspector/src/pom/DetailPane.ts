import type { Locator } from "@playwright/test";

import { PageObjectsView } from "./PageObjectsView";
import { RunCard } from "./RunCard";

/** The detail pane: the view of what's selected, with its run cards. */
export class DetailPane {
  readonly root: Locator;
  /** The skeleton's Page objects view, for the page and for a model. */
  readonly pageObjects: PageObjectsView;

  constructor(root: Locator) {
    this.root = root;
    this.pageObjects = new PageObjectsView(root);
  }

  /**
   * A run card, by its action's name, e.g. "addItem". Without a name, the
   * view's only run card, as on a tool's own view.
   */
  runCard(action?: string): RunCard {
    return new RunCard(
      action === undefined
        ? this.root.getByRole("form")
        : this.root.getByRole("form", { name: action, exact: true })
    );
  }
}
