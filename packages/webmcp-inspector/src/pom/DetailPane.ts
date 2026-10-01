import type { Locator } from "@playwright/test";

import { ModelDetailView } from "./ModelDetailView";
import { NodeView } from "./NodeView";
import { RunCard } from "./RunCard";

/** The detail pane: the view of what's selected, with its run cards. */
export class DetailPane {
  readonly root: Locator;
  /** The Model lens's view of the page, a Page Object or a model. */
  readonly model: ModelDetailView;
  /** A structure node's view. */
  readonly node: NodeView;

  constructor(root: Locator) {
    this.root = root;
    this.model = new ModelDetailView(root);
    this.node = new NodeView(root);
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
