import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

/** A page large enough that a read of it takes a while, with a field that
 * has the focus from the start. */
export class LargePage extends FixturePage {
  readonly path = "/large.html";

  @ayme.child({ description: "Has the focus when the page loads." })
  get noteInput() {
    return this.page.getByRole("textbox", { name: "Note" });
  }

  @ayme.child({
    description:
      '"Not saved", "Saving 1" to "Saving 9" after typing, then "Saved".',
  })
  get noteState() {
    return this.page.locator("#note-state");
  }

  @ayme.child({ description: 'Sets the mark state to "Marked" at once.' })
  get markButton() {
    return this.page.getByRole("button", { name: "Mark" });
  }

  @ayme.child({ description: '"Not marked", then "Marked".' })
  get markState() {
    return this.page.locator("#mark-state");
  }
}
