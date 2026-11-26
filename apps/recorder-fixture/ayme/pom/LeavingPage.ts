import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

export class LeavingPage extends FixturePage {
  readonly path = "/leaving.html";

  @ayme.child({
    description:
      "Goes to the checkout as the mouse is released, before the click that follows.",
  })
  get leaveButton() {
    return this.page.getByRole("button", { name: "Leave" });
  }

  @ayme.child
  get stayButton() {
    return this.page.getByRole("button", { name: "Stay" });
  }

  // Not by its text, which is what changes.
  @ayme.child({ description: '"Not stayed", then "Stayed".' })
  get stayed() {
    return this.page.locator("#stayed");
  }
}
