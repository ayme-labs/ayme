import type { Locator } from "@playwright/test";

import { ModelLens } from "./ModelLens";

export type LensName = "Model" | "Structure" | "Tools";

/**
 * The navigator: search, the lens switcher, the legend and the active lens's
 * tree. Each lens's own page object works inside {@link Navigator.root}.
 */
export class Navigator {
  readonly root: Locator;
  readonly searchBox: Locator;
  readonly legend: Locator;
  readonly searchResults: Locator;
  readonly noResults: Locator;
  /** The Model lens's tree. */
  readonly model: ModelLens;

  constructor(root: Locator) {
    this.root = root;
    this.searchBox = root.getByRole("searchbox");
    this.legend = root.getByRole("group", { name: "Legend" });
    this.searchResults = root
      .getByRole("list", { name: "Search results" })
      .getByRole("button");
    this.noResults = root.getByText("Nothing matches.");
    this.model = new ModelLens(root);
  }

  lens(name: LensName): Locator {
    return this.root
      .getByRole("group", { name: "Lens" })
      .getByRole("button", { name, exact: true });
  }

  async showLens(name: LensName) {
    await this.lens(name).click();
  }

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
