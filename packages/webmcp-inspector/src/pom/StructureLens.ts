import type { Locator } from "@playwright/test";

/**
 * The Structure lens in the navigator: the page's structure as a tree of
 * nodes, each tagged with the Page Object member it maps to.
 */
export class StructureLens {
  readonly root: Locator;
  readonly tree: Locator;
  /** Every row: nodes with a ref, and text. */
  readonly rows: Locator;
  /** Why the structure could not be captured. */
  readonly error: Locator;

  constructor(navigator: Locator) {
    this.root = navigator;
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
  async memberOf(ref: string): Promise<string | null> {
    const tag = this.node(ref).getByTitle(/./);
    return (await tag.count()) ? tag.getAttribute("title") : null;
  }

  /** Selects a node; the page highlights the selected node. */
  async pick(ref: string) {
    await this.node(ref).click();
  }
}
