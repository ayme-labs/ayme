import { ayme } from "@ayme-dev/ayme";

import { ModelDetailView } from "./ModelDetailView";
import { NodeView } from "./NodeView";
import { PanelPart } from "./PanelPart";
import { RunCard } from "./RunCard";
import { ToolPage } from "./ToolPage";

/** The detail pane: the view of what's selected, with its run cards. */
export class DetailPane extends PanelPart {
  /** The Model lens's view of the page, a Page Object or a model. */
  @ayme.child
  get model(): ModelDetailView {
    return new ModelDetailView(this.root);
  }

  /** A structure node's view. */
  @ayme.child
  get node(): NodeView {
    return new NodeView(this.root);
  }

  /** A tool's page, from the Tools lens. */
  @ayme.child
  get toolPage(): ToolPage {
    return new ToolPage(this.root);
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
