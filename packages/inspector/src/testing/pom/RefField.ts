import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

/**
 * A run card's ref field: it chooses a ref from a searchable tree of the
 * page's structure, or by pointing at the page. A card has one ref field.
 */
@ayme
export class RefField {
  /** Shows the ref chosen, e.g. `e6 button "Add item"`, and opens the tree. */
  readonly chooser: Locator;
  /** The crosshair: picks a ref by pointing at the page. */
  readonly pickButton: Locator;
  /** While picking: what to click on the page. */
  readonly pickHint: Locator;
  readonly search: Locator;
  readonly tree: Locator;
  /** The tree's nodes, each read as its ref, role and name. */
  readonly nodes: Locator;

  constructor(card: Locator, path: string) {
    this.chooser = card.getByRole("button", { name: path, exact: true });
    this.pickButton = card.getByRole("button", {
      name: "Pick an element on the page",
    });
    this.pickHint = card.getByText(/Esc cancels\.$/);
    this.search = card.getByRole("textbox", {
      name: "Search the page structure",
    });
    this.tree = card.getByRole("tree", { name: "Page structure" });
    this.nodes = this.tree.getByRole("treeitem");
  }

  /** The ref chosen, as the field shows it, e.g. `e6 button "Add item"`. */
  async value(): Promise<string | undefined> {
    const text = await this.chooser.textContent();
    return text === "Choose an element" ? undefined : (text ?? undefined);
  }

  /** A node of the tree, by its ref, e.g. "e6". */
  node(ref: string): Locator {
    return this.nodes.filter({ hasText: new RegExp(`^${ref}(?!\\d)`) });
  }

  /** A node of the tree, by its role and name, e.g. button "Add item". */
  nodeNamed(role: string, name: string): Locator {
    const escaped = `${role}${JSON.stringify(name)}`.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );
    return this.nodes.filter({ hasText: new RegExp(`^e\\d+${escaped}$`) });
  }

  /** Opens the tree, when it's closed. */
  @ayme.action({ description: "Opens the tree, when it is closed." })
  async open() {
    if ((await this.chooser.getAttribute("aria-expanded")) !== "true")
      await this.chooser.click();
  }

  /** Searches the tree. */
  @ayme.action({ description: "Searches the tree." })
  async find(query: string) {
    await this.open();
    await this.search.fill(query);
  }

  /** Chooses a ref from the tree. */
  @ayme.action({ description: "Chooses a ref from the tree." })
  async choose(ref: string) {
    await this.find(ref);
    await this.node(ref).click();
  }

  /**
   * Starts picking on the page; the next click on the page picks. Picking
   * reads the panel's look at the page, so it waits for the structure first.
   */
  @ayme.action({
    description:
      "Starts picking on the page; the next click on the page picks.",
  })
  async pickOnPage() {
    if ((await this.pickButton.getAttribute("aria-pressed")) === "true") return;
    await this.open();
    await this.nodes.first().waitFor();
    await this.pickButton.click();
  }

  /** Whether it's picking on the page. */
  async isPicking() {
    return (await this.pickButton.getAttribute("aria-pressed")) === "true";
  }
}
