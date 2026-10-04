import type { Locator } from "@playwright/test";

export type ModelDetailSection =
  "On this page" | "Actions" | "Members" | "Tools";

/**
 * The Model lens's detail: the page, a Page Object or a Page Object Model.
 * Each shows a title, then sections: the Page Objects on the page, the
 * actions (run through the run slot) and the members; the page shows its
 * page-wide tools.
 */
export class ModelDetailView {
  readonly root: Locator;
  readonly title: Locator;
  /** The link from a Page Object or a child Page Object member to its model. */
  readonly modelLink: Locator;
  /** A member's link to the Page Object or model it belongs to. */
  readonly ownerLink: Locator;

  constructor(root: Locator) {
    this.root = root;
    this.title = root.getByRole("heading", { level: 3 });
    this.modelLink = root.getByRole("button", {
      name: /^Open the \S+ page object model$/,
    });
    this.ownerLink = root.getByRole("button", { name: /^Open its owner / });
  }

  /**
   * One fact of a member's detail: "Owner", "Declared as", "On the page" or
   * "Page object".
   */
  fact(term: string): Locator {
    return this.root
      .getByRole("group", { name: term, exact: true })
      .locator("dd");
  }

  /** A member's link to its child Page Object on the page, by path. */
  objectLink(path: string): Locator {
    return this.root.getByRole("button", { name: `Open ${path}`, exact: true });
  }

  section(name: ModelDetailSection): Locator {
    return this.root.getByRole("region", { name, exact: true });
  }

  /**
   * A member, by name. It highlights on the page while hovered and is
   * selected on click.
   */
  member(name: string): Locator {
    return this.section("Members").getByLabel(name, { exact: true });
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

  /** An action shown, dimmed, because its Page Object isn't on the page. */
  offPageAction(name: string): Locator {
    return this.section("Actions").getByRole("group", { name, exact: true });
  }
}
