import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

import { PanelPart } from "./PanelPart";

/**
 * The Structure lens in the navigator: the page's structure as a tree of
 * nodes, each tagged with the Page Object member it maps to.
 */
export class StructureLens extends PanelPart {
  readonly tree: Locator;
  /** Every row: nodes with a ref, and text. */
  readonly rows: Locator;
  /** Why the structure could not be captured. */
  readonly error: Locator;

  constructor(navigator: Locator) {
    super(navigator);
    this.tree = navigator.getByRole("tree", { name: "Page structure" });
    this.rows = this.tree.getByRole("treeitem");
    this.error = navigator.getByRole("alert");
  }

  /** A node, by its ref. Hovering highlights it on the page. */
  node(ref: string): Locator {
    return this.tree.getByRole("treeitem", {
      name: new RegExp(`^${ref} `),
    });
  }

  /** A node by its role and name, e.g. ("checkbox", "Urgent"). */
  nodeNamed(role: string, name: string): Locator {
    return this.tree.getByRole("treeitem", {
      name: new RegExp(`^e\\d+ ${role} ${JSON.stringify(name)}`),
    });
  }

  /** The node tagged with a Page Object member, e.g. "ListPage.addItemButton". */
  nodeOf(member: string): Locator {
    return this.rows.filter({
      has: this.root.page().getByTitle(member, { exact: true }),
    });
  }

  /** The member a node is tagged with, in full. */
  @ayme.action({
    description: "Reads the Page Object member a node is tagged with, in full.",
  })
  async memberOf(ref: string): Promise<string | null> {
    const tag = this.node(ref).getByTitle(/./);
    return (await tag.count()) ? tag.getAttribute("title") : null;
  }

  /**
   * Selects the outermost wrapper of a folded chain by its ref, which leads
   * the row the chain folds into.
   */
  @ayme.action({
    description:
      "Selects the outermost wrapper of a folded chain of wrappers by its ref.",
  })
  async pickWrapper(ref: string) {
    await this.tree.getByRole("button", { name: `${ref} generic` }).click();
  }

  /**
   * Folds or unfolds a chain of wrappers: on its folded row, by the ref of
   * the generic it ends in, or on its outermost wrapper's row when unfolded.
   */
  @ayme.action({
    description:
      "Folds or unfolds a chain of generic wrappers, from the row that has the toggle.",
  })
  async toggleWrappers(ref: string) {
    await this.node(ref)
      .getByRole("button", { name: /^(Unfold|Fold) wrappers$/ })
      .click();
  }

  /** Selects a node; the page highlights the selected node. */
  @ayme.action({
    description: "Selects a node by its ref; the page highlights it.",
  })
  async pick(ref: string) {
    // The node's own button: a folded row also holds its outer wrapper's.
    await this.node(ref)
      .getByRole("button", { name: new RegExp(`^${ref} `) })
      .click();
  }
}
