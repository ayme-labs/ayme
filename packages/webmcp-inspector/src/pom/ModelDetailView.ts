import type { Locator } from "@playwright/test";

export type ModelDetailSection = "On this page" | "Actions" | "Members";

/**
 * The Model lens's detail: the page, a Page Object or a Page Object Model.
 * Each shows a title, then sections: the Page Objects on the page, the
 * actions (run through the run slot) and the members.
 */
export class ModelDetailView {
  readonly root: Locator;
  readonly title: Locator;
  /** The link from a Page Object to its Page Object Model. */
  readonly modelLink: Locator;

  constructor(root: Locator) {
    this.root = root;
    this.title = root.getByRole("heading", { level: 3 });
    this.modelLink = root.getByRole("button", {
      name: /^Open the \S+ page object model$/,
    });
  }

  section(name: ModelDetailSection): Locator {
    return this.root.getByRole("region", { name, exact: true });
  }

  /**
   * A member, by name. A locator highlights while hovered and pins on click;
   * a child Page Object or model opens on click.
   */
  member(name: string): Locator {
    return this.section("Members").getByRole("button", {
      name,
      exact: true,
    });
  }

  /** "Locator" or "Page object": what a member's icon says it is. */
  async memberIcon(name: string) {
    return this.member(name)
      .locator("svg[aria-label]")
      .getAttribute("aria-label");
  }

  /** What a member is and what the page probe found, e.g. "locator · 1 match". */
  async memberDescription(name: string) {
    return this.member(name).getAttribute("aria-description");
  }

  /** A Page Object listed under "On this page", by path. */
  instance(path: string): Locator {
    return this.section("On this page").getByRole("button", {
      name: path,
      exact: true,
    });
  }

  /** An action shown, dimmed, because WebMCP doesn't publish its tool now. */
  unpublishedAction(name: string): Locator {
    return this.section("Actions").getByRole("group", { name, exact: true });
  }
}
