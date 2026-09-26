import type { Locator } from "@playwright/test";

import { ModelDetailView } from "./ModelDetailView";
import { ToolForm } from "./ToolForm";

/** The detail pane: the view of what's selected, with its run slot. */
export class DetailPane {
  readonly root: Locator;
  /** The Model lens's view of the page, a Page Object or a model. */
  readonly model: ModelDetailView;

  constructor(root: Locator) {
    this.root = root;
    this.model = new ModelDetailView(root);
  }

  /** The run slot for a tool. */
  tool(name: string): ToolForm {
    return new ToolForm(this.root.locator(`form[data-tool-name="${name}"]`));
  }
}
