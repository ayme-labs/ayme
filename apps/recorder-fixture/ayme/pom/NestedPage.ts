import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

/** Links and a button whose text is in elements of their own, and a
 * checkbox. */
export class NestedPage extends FixturePage {
  readonly path = "/nested.html";

  @ayme.child({ description: 'Says "Pull requests opened".' })
  get pullRequestsLink() {
    return this.page.getByRole("link", {
      name: "Pull requests 12",
    });
  }

  /** The box its label is in, which the page structure lists. */
  @ayme.child
  get pullRequestsLabel() {
    return this.pullRequestsLink.locator(".label");
  }

  @ayme.child({ description: 'Says "Repository opened".' })
  get repositoryLink() {
    return this.page.getByRole("link", { name: "ayme" });
  }

  /** The element its text is in, which the page structure does not list. */
  @ayme.child
  get repositoryText() {
    return this.repositoryLink.locator("span");
  }

  @ayme.child({
    description:
      'Says "Code opened", "Code opened twice" on a double click, "Code menu" on a right-click, and "Code in the background" on a middle click.',
  })
  get codeButton() {
    return this.page.getByRole("button", { name: "Code" });
  }

  /** The element its label is in, which the page structure does not list. */
  @ayme.child
  get codeText() {
    return this.codeButton.getByText("Code");
  }

  @ayme.child({
    description:
      'Says "Done checked" or "Done unchecked", and "Done in the background" on a middle click, which leaves it as it is.',
  })
  get doneBox() {
    return this.page.getByRole("checkbox", { name: "Done" });
  }

  @ayme.child({ description: "What the last input did." })
  get said() {
    return this.page.locator("#said");
  }
}
