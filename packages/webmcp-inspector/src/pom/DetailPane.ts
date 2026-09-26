import type { Locator } from "@playwright/test";

import { PageObjectsView } from "./PageObjectsView";
import { ToolForm } from "./ToolForm";
import { ToolPage } from "./ToolPage";

/** The detail pane: the view of what's selected, with its run slot. */
export class DetailPane {
  readonly root: Locator;
  /** The skeleton's Page objects view, for the page and for a model. */
  readonly pageObjects: PageObjectsView;
  /** A tool's page, from the Tools lens. */
  readonly toolPage: ToolPage;

  constructor(root: Locator) {
    this.root = root;
    this.pageObjects = new PageObjectsView(root);
    this.toolPage = new ToolPage(root);
  }

  /** The run slot for a tool. */
  tool(name: string): ToolForm {
    return new ToolForm(this.root.locator(`form[data-tool-name="${name}"]`));
  }
}
