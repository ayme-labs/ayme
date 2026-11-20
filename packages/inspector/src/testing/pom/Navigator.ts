import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

import { ModelLens } from "./ModelLens";
import { PanelPart } from "./PanelPart";
import { ToolsLens } from "./ToolsLens";

export type LensName = "Model" | "Structure" | "Tools";

/**
 * The navigator: search, the lens switcher, the legend and the active lens's
 * tree. Each lens's own page object works inside {@link Navigator.root}.
 */
export class Navigator extends PanelPart {
  /** The Model lens's tree. */
  @ayme.child
  readonly model: ModelLens;
  /** The Tools lens's tree, while that lens is shown. */
  @ayme.child
  readonly tools: ToolsLens;

  constructor(root: Locator) {
    super(root);
    this.model = new ModelLens(root);
    this.tools = new ToolsLens(root);
  }

  @ayme.child
  get searchBox(): Locator {
    return this.root.getByRole("searchbox");
  }

  @ayme.child
  get legend(): Locator {
    return this.root.getByRole("group", { name: "Legend" });
  }

  @ayme.collection
  get searchResults(): Locator {
    return this.root
      .getByRole("list", { name: "Search results" })
      .getByRole("button");
  }

  @ayme.child
  get noResults(): Locator {
    return this.root.getByText("Nothing matches.");
  }

  lens(name: LensName): Locator {
    return this.root
      .getByRole("group", { name: "Lens" })
      .getByRole("button", { name, exact: true });
  }

  @ayme.action({ description: "Shows a lens: Model, Structure or Tools." })
  async showLens(name: LensName) {
    await this.lens(name).click();
  }

  @ayme.action({ description: "Searches the active lens." })
  async search(query: string) {
    await this.searchBox.fill(query);
  }

  /** A search result, by its label. */
  result(label: string): Locator {
    return this.searchResults.filter({ hasText: label });
  }

  /** An entry in the active lens's tree, by its text. */
  item(text: string): Locator {
    return this.root.getByRole("button", { name: text, exact: true });
  }
}
