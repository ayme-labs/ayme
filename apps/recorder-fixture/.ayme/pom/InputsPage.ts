import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

/** Every kind of input: typing, keys, a native select, a file, a double
 * click, an element its structure does not list, a frame and a shadow root. */
export class InputsPage extends FixturePage {
  readonly path = "/inputs.html";

  @ayme.child({ description: "Enter adds what it holds to the list." })
  readonly itemInput = this.page.getByRole("textbox", { name: "Item" });
  @ayme.collection
  readonly listItems = this.page
    .getByRole("list", { name: "Shopping list" })
    .getByRole("listitem");
  @ayme.child
  readonly sizeSelect = this.page.getByRole("combobox", { name: "Size" });
  @ayme.child
  readonly photoInput = this.page.getByRole("button", { name: "Photo" });
  // A decoration with no role, in a group that has one: the page structure
  // lists the group only.
  @ayme.child
  readonly star = this.page.locator("#star");
  // Not by its text, which is what changes.
  @ayme.child({ description: '"Not starred", then "Starred".' })
  readonly starred = this.page.locator("#starred");
  @ayme.child
  readonly openTwiceButton = this.page.getByRole("button", {
    name: "Open twice",
  });
  @ayme.child({ description: '"Opened <n> times", by double clicks.' })
  readonly opened = this.page.locator("#opened");
  // In an open shadow root.
  @ayme.child
  readonly shadowButton = this.page.getByRole("button", {
    name: "Shadow button",
  });
  @ayme.child
  readonly shadowState = this.page.locator("#shadowSaid");

  // In a same-origin frame. Ayme runs a served Page Object on Playwright
  // Lite, which does not enter frames: these are left undeclared, and built
  // only when a test reads them.
  get innerButton() {
    return this.page
      .frameLocator("#frame")
      .getByRole("button", { name: "Inner button" });
  }
  get innerState() {
    return this.page.frameLocator("#frame").locator("#innerSaid");
  }

  /** Every key the page has received, in order. */
  async keys(): Promise<string[]> {
    return (await this.page.evaluate("window.keys")) as string[];
  }

  /** Leaves nothing focused: a key then goes to the page itself. */
  async blur() {
    await this.page.evaluate("document.activeElement.blur()");
  }
}
