import type { Locator } from "@playwright/test";

import { NodeView } from "./NodeView";
import { PageObjectsView } from "./PageObjectsView";
import { ToolForm } from "./ToolForm";

/** The detail pane: the view of what's selected, with its run slot. */
export class DetailPane {
  readonly root: Locator;
  /** The skeleton's Page objects view, for the page and for a model. */
  readonly pageObjects: PageObjectsView;
  /** A structure node's view. */
  readonly node: NodeView;

  constructor(root: Locator) {
    this.root = root;
    this.pageObjects = new PageObjectsView(root);
    this.node = new NodeView(root);
  }

  /** The run slot for a tool. */
  tool(name: string): ToolForm {
    return new ToolForm(this.root.locator(`form[data-tool-name="${name}"]`));
  }
}
